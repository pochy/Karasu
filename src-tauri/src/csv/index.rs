use crate::csv::scanner::{record_end, strip_bom};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const CHECKPOINT_INTERVAL: u64 = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexFile {
    pub version: u32,
    pub source_size: u64,
    pub source_modified: u128,
    pub checkpoints: Vec<(u64, u64)>,
    pub total_rows: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct CheckpointIndex {
    pub checkpoints: Vec<(u64, u64)>,
    pub total_rows: Option<u64>,
}

impl CheckpointIndex {
    pub fn row_count(&self) -> u64 {
        self.total_rows.unwrap_or_else(|| {
            self.checkpoints
                .last()
                .map(|(row, _)| row + 1)
                .unwrap_or(0)
        })
    }

    pub fn nearest_checkpoint(&self, row: u64) -> (u64, u64) {
        let mut best = (0u64, 0u64);
        for &(cp_row, offset) in &self.checkpoints {
            if cp_row <= row {
                best = (cp_row, offset);
            } else {
                break;
            }
        }
        best
    }
}

fn file_modified_ms(path: &Path) -> std::io::Result<u128> {
    let meta = fs::metadata(path)?;
    let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    Ok(modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis())
}

pub fn index_cache_path(cache_dir: &Path, source: &Path) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    cache_dir.join(format!("csv-index-{:x}.json", hasher.finish()))
}

pub fn load_cached_index(
    cache_dir: &Path,
    source: &Path,
    source_size: u64,
) -> Option<CheckpointIndex> {
    let path = index_cache_path(cache_dir, source);
    let text = fs::read_to_string(&path).ok()?;
    let file: IndexFile = serde_json::from_str(&text).ok()?;
    if file.version != 1 || file.source_size != source_size {
        return None;
    }
    let modified = file_modified_ms(source).ok()?;
    if file.source_modified != modified {
        return None;
    }
    Some(CheckpointIndex {
        checkpoints: file.checkpoints,
        total_rows: file.total_rows,
    })
}

pub fn save_index(cache_dir: &Path, source: &Path, index: &CheckpointIndex) -> Result<(), String> {
    fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    let modified = file_modified_ms(source).map_err(|e| e.to_string())?;
    let source_size = fs::metadata(source).map_err(|e| e.to_string())?.len();
    let file = IndexFile {
        version: 1,
        source_size,
        source_modified: modified,
        checkpoints: index.checkpoints.clone(),
        total_rows: index.total_rows,
    };
    let path = index_cache_path(cache_dir, source);
    let json = serde_json::to_string(&file).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn build_index_from_file(
    path: &Path,
    should_continue: impl Fn() -> bool,
    mut on_progress: impl FnMut(u64, bool),
) -> Result<CheckpointIndex, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 1024 * 1024];
    let mut carry = Vec::new();
    let mut offset: u64 = 0;
    let mut row: u64 = 0;
    let mut index = CheckpointIndex {
        checkpoints: vec![(0, 0)],
        total_rows: None,
    };

    loop {
        if !should_continue() {
            return Err("索引構築がキャンセルされました".to_string());
        }
        let read = file.read(&mut buf).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        carry.extend_from_slice(&buf[..read]);
        let mut scan_start = 0usize;
        if row == 0 && offset == 0 {
            let stripped = strip_bom(&carry);
            scan_start = carry.len() - stripped.len();
        }
        while scan_start < carry.len() {
            if !should_continue() {
                return Err("索引構築がキャンセルされました".to_string());
            }
            match record_end(&carry, scan_start) {
                Some(end) if end > scan_start => {
                    row += 1;
                    offset += (end - scan_start) as u64;
                    scan_start = end;
                    if row % CHECKPOINT_INTERVAL == 0 {
                        index.checkpoints.push((row, offset));
                        on_progress(row, false);
                        if !should_continue() {
                            return Err("索引構築がキャンセルされました".to_string());
                        }
                    }
                }
                Some(_) => break,
                None => break,
            }
        }
        if scan_start > 0 {
            carry.drain(..scan_start);
        }
        if read < buf.len() {
            break;
        }
    }
    if !carry.is_empty() {
        row += 1;
    }
    index.total_rows = Some(row);
    on_progress(row, true);
    Ok(index)
}

pub fn read_row_bytes(
    file: &mut File,
    index: &CheckpointIndex,
    row: u64,
) -> Result<Vec<u8>, String> {
    if row >= index.row_count() {
        return Err(format!("行 {row} は範囲外です"));
    }
    let (start_row, start_offset) = index.nearest_checkpoint(row);
    file.seek(SeekFrom::Start(start_offset))
        .map_err(|e| e.to_string())?;
    let mut chunk = [0u8; 64 * 1024];
    let mut current_row = start_row;
    let mut record = Vec::new();

    while current_row <= row {
        let n = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        let mut pos = 0usize;
        if current_row == 0 && start_offset == 0 && record.is_empty() {
            let stripped = strip_bom(&chunk[..n]);
            pos = n - stripped.len();
        }
        while pos < n {
            let slice = &chunk[pos..n];
            match record_end(slice, 0) {
                Some(end) if end > 0 => {
                    record.extend_from_slice(&slice[..end]);
                    let trimmed = trim_record_terminator(&record);
                    if current_row == row {
                        return Ok(trimmed.to_vec());
                    }
                    record.clear();
                    current_row += 1;
                    pos += end;
                }
                _ => {
                    record.extend_from_slice(slice);
                    break;
                }
            }
        }
        if n < chunk.len() {
            break;
        }
    }
    if current_row == row && !record.is_empty() {
        return Ok(trim_record_terminator(&record).to_vec());
    }
    Err(format!("行 {row} を読み取れませんでした"))
}

fn trim_record_terminator(record: &[u8]) -> &[u8] {
    if record.ends_with(b"\r\n") {
        &record[..record.len() - 2]
    } else if record.ends_with(b"\n") || record.ends_with(b"\r") {
        &record[..record.len() - 1]
    } else {
        record
    }
}
