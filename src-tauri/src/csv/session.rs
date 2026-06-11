use crate::csv::index::{
    build_index_from_file, load_cached_index, read_row_bytes, save_index, CheckpointIndex,
};
use crate::csv::scanner::{parse_fields, record_end, serialize_fields, strip_bom};
use crate::recent;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const MEMORY_THRESHOLD: u64 = 100 * 1024 * 1024;
pub const BOOTSTRAP_BYTES: usize = 4 * 1024 * 1024;
pub const BOOTSTRAP_MAX_ROWS: u64 = 1000;
pub const ROW_CACHE_MAX_BYTES: usize = 48 * 1024 * 1024;

static SESSION_EPOCH: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
pub struct CsvOpenResult {
    pub path: String,
    pub file_size: u64,
    pub streaming: bool,
    pub row_count: u64,
    pub column_count: u32,
    pub headers: Vec<String>,
    pub index_ready: bool,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CsvRowBatch {
    pub start_row: u64,
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug)]
struct RowCache {
    max_bytes: usize,
    used_bytes: usize,
    order: VecDeque<u64>,
    data: HashMap<u64, Vec<u8>>,
}

impl RowCache {
    fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            used_bytes: 0,
            order: VecDeque::new(),
            data: HashMap::new(),
        }
    }

    fn clear(&mut self) {
        self.data.clear();
        self.order.clear();
        self.used_bytes = 0;
    }

    fn get(&self, row: u64) -> Option<&Vec<u8>> {
        self.data.get(&row)
    }

    fn insert(&mut self, row: u64, bytes: Vec<u8>) {
        let size = bytes.len();
        if let Some(old) = self.data.remove(&row) {
            self.used_bytes = self.used_bytes.saturating_sub(old.len());
            self.order.retain(|r| *r != row);
        }
        while self.used_bytes + size > self.max_bytes {
            if let Some(old_row) = self.order.pop_front() {
                if let Some(old) = self.data.remove(&old_row) {
                    self.used_bytes = self.used_bytes.saturating_sub(old.len());
                }
            } else {
                break;
            }
        }
        self.used_bytes += size;
        self.order.push_back(row);
        self.data.insert(row, bytes);
    }
}

enum LoadMode {
    InMemory {
        rows: Vec<Vec<String>>,
    },
    Streaming {
        index: CheckpointIndex,
        index_ready: bool,
        row_cache: RowCache,
    },
}

struct CsvSession {
    path: PathBuf,
    file_size: u64,
    mode: LoadMode,
    column_count: u32,
    overrides: HashMap<(u64, u32), String>,
    dirty: bool,
    epoch: u64,
}

pub struct CsvRegistry {
    sessions: HashMap<String, CsvSession>,
}

impl CsvRegistry {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

pub struct CsvState(pub Mutex<CsvRegistry>);

fn drop_session_memory(session: &mut CsvSession) {
    session.overrides.clear();
    match &mut session.mode {
        LoadMode::InMemory { rows } => {
            rows.clear();
            rows.shrink_to_fit();
        }
        LoadMode::Streaming {
            index,
            row_cache,
            ..
        } => {
            row_cache.clear();
            index.checkpoints.clear();
            index.checkpoints.shrink_to_fit();
            index.total_rows = None;
        }
    }
}

/// バックグラウンド索引構築などを無効化し、全 CSV セッションのメモリを解放する。
fn invalidate_all_sessions(reg: &mut CsvRegistry) {
    SESSION_EPOCH.fetch_add(1, Ordering::Relaxed);
    for (_, session) in reg.sessions.iter_mut() {
        drop_session_memory(session);
    }
    reg.sessions.clear();
    trim_process_heap();
}

#[cfg(target_os = "macos")]
fn trim_process_heap() {
    extern "C" {
        fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
    }
    unsafe {
        malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn trim_process_heap() {}

fn cache_dir_for(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .cache_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("csv-index"))
}

fn bootstrap_file(path: &Path, file_size: u64) -> Result<(u64, u32, Vec<String>), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let to_read = std::cmp::min(file_size as usize, BOOTSTRAP_BYTES);
    let mut buf = vec![0u8; to_read];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    let data = strip_bom(&buf);

    let mut row_count = 0u64;
    let mut col_count = 0u32;
    let mut headers = Vec::new();
    let mut start = 0usize;
    while row_count < BOOTSTRAP_MAX_ROWS && start < data.len() {
        let Some(end) = record_end(data, start) else {
            break;
        };
        if end <= start {
            break;
        }
        let record = &data[start..end];
        let trimmed = trim_record(record);
        let fields = parse_fields(trimmed);
        if row_count == 0 {
            headers = fields.clone();
            col_count = fields.len().max(1) as u32;
        } else {
            col_count = col_count.max(fields.len() as u32);
        }
        row_count += 1;
        start = end;
    }

    if row_count == 0 {
        return Ok((0, 1, vec!["列1".to_string()]));
    }

    let estimated = if start >= data.len() || file_size <= n as u64 {
        row_count
    } else {
        let bytes_per_row = (start as u64).saturating_div(row_count).max(1);
        file_size / bytes_per_row
    };

    Ok((estimated, col_count.max(1), headers))
}

fn trim_record(record: &[u8]) -> &[u8] {
    if record.ends_with(b"\r\n") {
        &record[..record.len() - 2]
    } else if record.ends_with(b"\n") || record.ends_with(b"\r") {
        &record[..record.len() - 1]
    } else {
        record
    }
}

fn load_in_memory(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    file.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let data = strip_bom(&raw);
    let mut rows = Vec::new();
    let mut start = 0usize;
    while start < data.len() {
        let Some(end) = record_end(data, start) else {
            break;
        };
        if end <= start {
            break;
        }
        rows.push(parse_fields(trim_record(&data[start..end])));
        start = end;
    }
    Ok(rows)
}

fn apply_overrides_to_row(session: &CsvSession, row_index: u64, fields: &mut Vec<String>) {
    let col_count = session.column_count as usize;
    if fields.len() < col_count {
        fields.resize(col_count, String::new());
    }
    for col in 0..col_count {
        if let Some(value) = session.overrides.get(&(row_index, col as u32)) {
            fields[col] = value.clone();
        }
    }
}

fn read_row_bytes_cached(session: &mut CsvSession, row: u64) -> Result<Vec<u8>, String> {
    match &mut session.mode {
        LoadMode::InMemory { .. } => Err("内部エラー: メモリモードでストリーム読み込み".to_string()),
        LoadMode::Streaming { index, row_cache, .. } => {
            if let Some(cached) = row_cache.get(row) {
                return Ok(cached.clone());
            }
            let index = index.clone();
            let path = session.path.clone();
            let mut file = File::open(&path).map_err(|e| e.to_string())?;
            let raw = read_row_bytes(&mut file, &index, row)?;
            row_cache.insert(row, raw.clone());
            Ok(raw)
        }
    }
}

fn read_row_fields(session: &mut CsvSession, row: u64) -> Result<Vec<String>, String> {
    let mut fields = match &session.mode {
        LoadMode::InMemory { rows } => rows
            .get(row as usize)
            .cloned()
            .unwrap_or_else(|| vec![String::new(); session.column_count as usize]),
        LoadMode::Streaming { .. } => parse_fields(&read_row_bytes_cached(session, row)?),
    };
    apply_overrides_to_row(session, row, &mut fields);
    Ok(fields)
}

fn spawn_index_build(app: AppHandle, path: PathBuf, cache_dir: PathBuf, epoch: u64) {
    std::thread::spawn(move || {
        let built = build_index_from_file(
            &path,
            || index_build_still_valid(&app, &path, epoch),
            |rows, done| {
                let _ = app.emit(
                    "csv-index-progress",
                    serde_json::json!({
                        "path": path.to_string_lossy(),
                        "rows": rows,
                        "done": done,
                    }),
                );
            },
        );
        if !index_build_still_valid(&app, &path, epoch) {
            return;
        }
        if let Ok(index) = &built {
            let _ = save_index(&cache_dir, &path, index);
            if let Some(state) = app.try_state::<CsvState>() {
                if let Ok(mut reg) = state.0.lock() {
                    let key = path.to_string_lossy().into_owned();
                    if let Some(session) = reg.sessions.get_mut(&key) {
                        if session.epoch != epoch {
                            return;
                        }
                        if let LoadMode::Streaming {
                            index: idx,
                            index_ready,
                            ..
                        } = &mut session.mode
                        {
                            *idx = index.clone();
                            *index_ready = true;
                        }
                    }
                }
            }
            let _ = app.emit(
                "csv-index-ready",
                serde_json::json!({
                    "path": path.to_string_lossy(),
                    "row_count": index.row_count(),
                }),
            );
        }
    });
}

fn index_build_still_valid(app: &AppHandle, path: &Path, epoch: u64) -> bool {
    let Some(state) = app.try_state::<CsvState>() else {
        return false;
    };
    let Ok(reg) = state.0.lock() else {
        return false;
    };
    let key = path.to_string_lossy();
    reg.sessions
        .get(key.as_ref())
        .is_some_and(|session| session.epoch == epoch)
}

pub fn csv_open(
    app: AppHandle,
    state: tauri::State<CsvState>,
    path: String,
) -> Result<CsvOpenResult, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_file() {
        return Err("CSV ファイルが存在しません".to_string());
    }
    let meta = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    let file_size = meta.len();
    recent::save_recent(&app, &path_buf)?;

    let cache_dir = cache_dir_for(&app)?;
    let (estimated_rows, col_count, headers) = bootstrap_file(&path_buf, file_size)?;
    let streaming = file_size > MEMORY_THRESHOLD;
    let epoch = SESSION_EPOCH.fetch_add(1, Ordering::Relaxed);

    let mode = if streaming {
        let index =
            load_cached_index(&cache_dir, &path_buf, file_size).unwrap_or_else(|| CheckpointIndex {
                checkpoints: vec![(0, 0)],
                total_rows: None,
            });
        let index_ready = index.total_rows.is_some();
        if !index_ready {
            spawn_index_build(app.clone(), path_buf.clone(), cache_dir.clone(), epoch);
        }
        LoadMode::Streaming {
            index,
            index_ready,
            row_cache: RowCache::new(ROW_CACHE_MAX_BYTES),
        }
    } else {
        let rows = load_in_memory(&path_buf)?;
        LoadMode::InMemory { rows }
    };

    let row_count = match &mode {
        LoadMode::InMemory { rows } => rows.len() as u64,
        LoadMode::Streaming { index, .. } => {
            if index.total_rows.is_some() {
                index.row_count()
            } else {
                estimated_rows
            }
        }
    };

    let index_ready = matches!(
        &mode,
        LoadMode::InMemory { .. } | LoadMode::Streaming { index_ready: true, .. }
    );

    let session = CsvSession {
        path: path_buf.clone(),
        file_size,
        mode,
        column_count: col_count,
        overrides: HashMap::new(),
        dirty: false,
        epoch,
    };

    let key = path_buf.to_string_lossy().into_owned();
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    for (_, session) in reg.sessions.iter_mut() {
        drop_session_memory(session);
    }
    reg.sessions.clear();
    reg.sessions.insert(key, session);

    Ok(CsvOpenResult {
        path,
        file_size,
        streaming,
        row_count,
        column_count: col_count,
        headers,
        index_ready,
        dirty: false,
    })
}

pub fn csv_read_rows(
    state: tauri::State<CsvState>,
    path: String,
    start_row: u64,
    count: u32,
) -> Result<CsvRowBatch, String> {
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    let session = reg
        .sessions
        .get_mut(&path)
        .ok_or_else(|| "CSV セッションがありません".to_string())?;
    let max_row = session_row_count(session);
    let count = count.min(500) as u64;
    let mut rows = Vec::new();
    for offset in 0..count {
        let row = start_row + offset;
        if row >= max_row {
            break;
        }
        rows.push(read_row_fields(session, row)?);
    }
    Ok(CsvRowBatch { start_row, rows })
}

pub fn csv_set_cell(
    state: tauri::State<CsvState>,
    path: String,
    row: u64,
    col: u32,
    value: String,
) -> Result<(), String> {
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    let session = reg
        .sessions
        .get_mut(&path)
        .ok_or_else(|| "CSV セッションがありません".to_string())?;
    if row >= session_row_count(session) {
        return Err("行が範囲外です".to_string());
    }
    if col >= session.column_count {
        return Err("列が範囲外です".to_string());
    }
    session.overrides.insert((row, col), value);
    session.dirty = true;
    Ok(())
}

pub fn csv_save(
    app: AppHandle,
    state: tauri::State<CsvState>,
    path: String,
    output_path: Option<String>,
) -> Result<String, String> {
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    let session = reg
        .sessions
        .get_mut(&path)
        .ok_or_else(|| "CSV セッションがありません".to_string())?;
    let dest = output_path
        .map(PathBuf::from)
        .unwrap_or_else(|| session.path.clone());
    let total = session_row_count(session);

    let tmp = dest.with_extension("karasu-tmp");
    let mut out = File::create(&tmp).map_err(|e| e.to_string())?;

    for row in 0..total {
        let fields = read_row_fields(session, row)?;
        let line = serialize_fields(&fields);
        out.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        if row + 1 < total {
            out.write_all(b"\n").map_err(|e| e.to_string())?;
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);

    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    session.path = dest.clone();
    session.overrides.clear();
    session.dirty = false;

    if matches!(session.mode, LoadMode::InMemory { .. }) && session.file_size <= MEMORY_THRESHOLD {
        let mut rows = Vec::new();
        for row in 0..total {
            rows.push(read_row_fields(session, row)?);
        }
        session.mode = LoadMode::InMemory { rows };
    }

    recent::save_recent(&app, &dest)?;
    Ok(dest.to_string_lossy().into_owned())
}

pub fn csv_close(state: tauri::State<CsvState>) -> Result<(), String> {
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    invalidate_all_sessions(&mut reg);
    Ok(())
}

fn session_row_count(session: &CsvSession) -> u64 {
    match &session.mode {
        LoadMode::InMemory { rows } => rows.len() as u64,
        LoadMode::Streaming { index, .. } => index.row_count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn bootstrap_estimates_rows() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("sample.csv");
        let mut f = File::create(&file).unwrap();
        for i in 0..100 {
            writeln!(f, "{i},value{i}").unwrap();
        }
        let size = std::fs::metadata(&file).unwrap().len();
        let (rows, cols, _) = bootstrap_file(&file, size).unwrap();
        assert_eq!(rows, 100);
        assert!(cols >= 2);
    }
}
