use crate::dir::{self, DirEntry};
use crate::fonts;
use crate::recent;
use crate::workspace;
use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
}

fn io_error(context: &str, err: std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => format!("{context}: ファイルが存在しません"),
        std::io::ErrorKind::PermissionDenied => {
            format!("{context}: 権限がありません")
        }
        _ => format!("{context}: {err}"),
    }
}

#[tauri::command]
pub fn read_file(app: AppHandle, path: String) -> Result<FileContent, String> {
    let path_buf = Path::new(&path);
    if path_buf.as_os_str().is_empty() {
        return Err("パスが指定されていません".to_string());
    }
    if !path_buf.exists() {
        return Err("ファイルが存在しません".to_string());
    }
    if !path_buf.is_file() {
        return Err("保存先が不正です".to_string());
    }

    let content =
        std::fs::read_to_string(path_buf).map_err(|e| io_error("読み込み", e))?;
    recent::save_recent(&app, path_buf)?;

    Ok(FileContent {
        path: path_buf.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
pub fn write_file(app: AppHandle, path: String, content: String) -> Result<(), String> {
    let path_buf = Path::new(&path);
    if path_buf.as_os_str().is_empty() {
        return Err("パスが指定されていません".to_string());
    }
    if let Some(parent) = path_buf.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("保存先が不正です".to_string());
        }
    }

    std::fs::write(path_buf, content).map_err(|e| io_error("保存", e))?;
    recent::save_recent(&app, path_buf)?;
    Ok(())
}

#[tauri::command]
pub fn get_recent_path(app: AppHandle) -> Option<String> {
    recent::load_recent(&app)
}

#[tauri::command]
pub fn list_system_fonts(mono_only: bool) -> Vec<String> {
    fonts::list_system_font_families(mono_only)
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    dir::list_directory(Path::new(&path))
}

#[tauri::command]
pub fn get_workspace_root(app: AppHandle) -> Option<String> {
    workspace::load_workspace_root(&app)
}

#[tauri::command]
pub fn set_workspace_root(app: AppHandle, path: String) -> Result<(), String> {
    let path_buf = Path::new(&path);
    if !path_buf.is_dir() {
        return Err("フォルダではありません".to_string());
    }
    workspace::save_workspace_root(&app, path_buf)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn read_existing_file_succeeds() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, "# Hello").unwrap();
        let content = fs::read_to_string(&file).unwrap();
        assert_eq!(content, "# Hello");
    }

    #[test]
    fn read_missing_file_fails() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("missing.md");
        assert!(!missing.exists());
        let err = fs::read_to_string(&missing).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn write_and_read_roundtrip() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("out.md");
        fs::write(&file, "updated").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "updated");
    }

    #[test]
    fn write_to_readonly_parent_fails() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("no-such-dir").join("file.md");
        let err = fs::write(&nested, "x").unwrap_err();
        assert!(err.kind() == std::io::ErrorKind::NotFound
            || err.kind() == std::io::ErrorKind::PermissionDenied);
    }
}
