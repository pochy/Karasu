use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "dist-ssr",
    "__pycache__",
    ".svn",
    ".hg",
];

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];
const JSON_EXTENSIONS: &[&str] = &["json", "jsonc"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Markdown,
    Json,
}

impl FileKind {
    pub fn parse(s: &str) -> Self {
        if s.eq_ignore_ascii_case("json") {
            FileKind::Json
        } else {
            FileKind::Markdown
        }
    }
}

pub fn should_skip_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return name != ".";
    }
    SKIP_DIR_NAMES.contains(&name)
}

pub fn is_markdown_file(path: &Path) -> bool {
    has_extension(path, MARKDOWN_EXTENSIONS)
}

pub fn is_json_file(path: &Path) -> bool {
    has_extension(path, JSON_EXTENSIONS)
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .map(|e| {
            let ext = e.to_string_lossy().to_lowercase();
            extensions.iter().any(|m| *m == ext)
        })
        .unwrap_or(false)
}

pub fn is_listable_file(path: &Path, kind: FileKind) -> bool {
    match kind {
        FileKind::Markdown => is_markdown_file(path),
        FileKind::Json => is_json_file(path),
    }
}

/// 1 階層だけ列挙する（遅延ツリー用）。
pub fn list_directory(path: &Path, kind: FileKind) -> Result<Vec<DirEntry>, String> {
    if !path.exists() {
        return Err("フォルダが存在しません".to_string());
    }
    if !path.is_dir() {
        return Err("フォルダではありません".to_string());
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(path).map_err(|e| format!("フォルダを読めません: {e}"))?;

    for item in read_dir {
        let item = item.map_err(|e| format!("フォルダを読めません: {e}"))?;
        let meta = item
            .metadata()
            .map_err(|e| format!("ファイル情報を取得できません: {e}"))?;
        let name = item.file_name().to_string_lossy().into_owned();
        let child_path: PathBuf = item.path();

        if meta.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            entries.push(DirEntry {
                name,
                path: child_path.to_string_lossy().into_owned(),
                is_dir: true,
            });
        } else if meta.is_file() && is_listable_file(&child_path, kind) {
            entries.push(DirEntry {
                name,
                path: child_path.to_string_lossy().into_owned(),
                is_dir: false,
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn lists_md_and_subdirs() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "a").unwrap();
        fs::write(dir.path().join("b.txt"), "b").unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::create_dir(dir.path().join("node_modules")).unwrap();

        let entries = list_directory(dir.path(), FileKind::Markdown).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"notes"));
        assert!(names.contains(&"a.md"));
        assert!(names.contains(&"b.txt"));
        assert!(!names.iter().any(|n| *n == "node_modules"));
    }
}
