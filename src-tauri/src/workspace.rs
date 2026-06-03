use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Default)]
struct WorkspaceStore {
    root: Option<String>,
}

fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("設定ディレクトリを取得できません: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("設定ディレクトリを作成できません: {e}"))?;
    Ok(dir.join("workspace.json"))
}

pub fn load_workspace_root(app: &AppHandle) -> Option<String> {
    let path = store_path(app).ok()?;
    let data = std::fs::read_to_string(path).ok()?;
    let store: WorkspaceStore = serde_json::from_str(&data).ok()?;
    store
        .root
        .filter(|p| Path::new(p).is_dir())
}

pub fn save_workspace_root(app: &AppHandle, root: &Path) -> Result<(), String> {
    let store = WorkspaceStore {
        root: Some(root.to_string_lossy().into_owned()),
    };
    let json = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("作業フォルダを保存できません: {e}"))?;
    std::fs::write(store_path(app)?, json)
        .map_err(|e| format!("作業フォルダを書き込めません: {e}"))?;
    Ok(())
}
