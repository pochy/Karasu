use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_RECENT: usize = 10;

#[derive(Debug, Serialize, Deserialize, Default)]
struct RecentStoreV2 {
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RecentStoreV1 {
    path: Option<String>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("設定ディレクトリを取得できません: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("設定ディレクトリを作成できません: {e}"))?;
    Ok(dir.join("recent.json"))
}

fn parse_store(data: &str) -> RecentStoreV2 {
    if let Ok(v2) = serde_json::from_str::<RecentStoreV2>(data) {
        return v2;
    }
    if let Ok(v1) = serde_json::from_str::<RecentStoreV1>(data) {
        return RecentStoreV2 {
            paths: v1.path.into_iter().collect(),
        };
    }
    RecentStoreV2::default()
}

fn filter_existing(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| Path::new(p).exists())
        .take(MAX_RECENT)
        .collect()
}

fn write_store(app: &AppHandle, store: &RecentStoreV2) -> Result<(), String> {
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("最近のファイルを保存できません: {e}"))?;
    std::fs::write(store_path(app)?, json)
        .map_err(|e| format!("最近のファイルを書き込めません: {e}"))?;
    Ok(())
}

pub fn save_recent(app: &AppHandle, path: &Path) -> Result<(), String> {
    let path_str = path.to_string_lossy().into_owned();
    let mut paths = load_recent_paths(app);
    paths.retain(|p| p != &path_str);
    paths.insert(0, path_str);
    paths.truncate(MAX_RECENT);
    write_store(
        app,
        &RecentStoreV2 {
            paths: filter_existing(paths),
        },
    )
}

pub fn load_recent_paths(app: &AppHandle) -> Vec<String> {
    let Some(path) = store_path(app).ok() else {
        return Vec::new();
    };
    let Ok(data) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let store = parse_store(&data);
    filter_existing(store.paths)
}

pub fn load_recent(app: &AppHandle) -> Option<String> {
    load_recent_paths(app).into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_v2_store() {
        let data = r#"{"paths":["/a.md","/b.md"]}"#;
        let store = parse_store(data);
        assert_eq!(store.paths, vec!["/a.md", "/b.md"]);
    }

    #[test]
    fn parse_v1_migration() {
        let data = r#"{"path":"/tmp/test.md"}"#;
        let store = parse_store(data);
        assert_eq!(store.paths, vec!["/tmp/test.md"]);
    }

    #[test]
    fn mru_order_dedup() {
        let mut paths = vec!["/b.md".to_string(), "/a.md".to_string()];
        let path_str = "/a.md".to_string();
        paths.retain(|p| p != &path_str);
        paths.insert(0, path_str);
        paths.truncate(MAX_RECENT);
        assert_eq!(paths[0], "/a.md");
        assert_eq!(paths[1], "/b.md");
    }
}
