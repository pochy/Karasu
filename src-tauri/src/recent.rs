use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Default)]
struct RecentStore {
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

pub fn save_recent(app: &AppHandle, path: &Path) -> Result<(), String> {
    let store = RecentStore {
        path: Some(path.to_string_lossy().into_owned()),
    };
    let json = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("最近のファイルを保存できません: {e}"))?;
    std::fs::write(store_path(app)?, json)
        .map_err(|e| format!("最近のファイルを書き込めません: {e}"))?;
    Ok(())
}

pub fn load_recent(app: &AppHandle) -> Option<String> {
    let path = store_path(app).ok()?;
    let data = std::fs::read_to_string(path).ok()?;
    let store: RecentStore = serde_json::from_str(&data).ok()?;
    store.path.filter(|p| Path::new(p).exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn roundtrip_recent_store_json() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("recent.json");
        let store = RecentStore {
            path: Some("/tmp/test.md".to_string()),
        };
        fs::write(&file, serde_json::to_string_pretty(&store).unwrap()).unwrap();
        let loaded: RecentStore = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(loaded.path.as_deref(), Some("/tmp/test.md"));
    }
}
