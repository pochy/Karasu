use crate::dir::{self, DirEntry, FileKind};
use std::path::Path;

const MAX_RESULTS: usize = 200;

pub fn search_filenames(
    root: &Path,
    query: &str,
    kind: FileKind,
) -> Result<Vec<DirEntry>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    if !root.exists() {
        return Err("フォルダが存在しません".to_string());
    }
    if !root.is_dir() {
        return Err("フォルダではありません".to_string());
    }

    let mut results = Vec::new();
    walk(root, &q, kind, &mut results)?;
    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

fn walk(
    dir: &Path,
    query: &str,
    kind: FileKind,
    results: &mut Vec<DirEntry>,
) -> Result<(), String> {
    if results.len() >= MAX_RESULTS {
        return Ok(());
    }

    let read_dir = std::fs::read_dir(dir).map_err(|e| format!("フォルダを読めません: {e}"))?;
    for item in read_dir {
        if results.len() >= MAX_RESULTS {
            return Ok(());
        }
        let item = item.map_err(|e| format!("フォルダを読めません: {e}"))?;
        let meta = item
            .metadata()
            .map_err(|e| format!("ファイル情報を取得できません: {e}"))?;
        let name = item.file_name().to_string_lossy().into_owned();
        let child_path = item.path();

        if meta.is_dir() {
            if dir::should_skip_dir(&name) {
                continue;
            }
            walk(&child_path, query, kind, results)?;
        } else if meta.is_file() && dir::is_listable_file(&child_path, kind) {
            if name.to_lowercase().contains(query) {
                results.push(DirEntry {
                    name,
                    path: child_path.to_string_lossy().into_owned(),
                    is_dir: false,
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn finds_by_filename() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("hello.md"), "").unwrap();
        fs::write(dir.path().join("other.txt"), "").unwrap();
        let sub = dir.path().join("notes");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("hello-note.md"), "").unwrap();

        let hits =
            search_filenames(dir.path(), "hello", FileKind::Markdown).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn skips_node_modules() {
        let dir = tempdir().unwrap();
        let nm = dir.path().join("node_modules");
        fs::create_dir(&nm).unwrap();
        fs::write(nm.join("hidden.md"), "").unwrap();
        fs::write(dir.path().join("visible.md"), "").unwrap();

        let hits = search_filenames(dir.path(), "md", FileKind::Markdown).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "visible.md");
    }

    #[test]
    fn empty_query_returns_empty() {
        let dir = tempdir().unwrap();
        assert!(
            search_filenames(dir.path(), "  ", FileKind::Markdown)
                .unwrap()
                .is_empty()
        );
    }
}
