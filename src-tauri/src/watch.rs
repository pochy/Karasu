use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct WatchState {
    pub watcher: Option<RecommendedWatcher>,
}

impl Default for WatchState {
    fn default() -> Self {
        Self { watcher: None }
    }
}

fn stop_watch(state: &mut WatchState) {
    state.watcher = None;
}

pub fn set_workspace_watch(
    app: &AppHandle,
    enabled: bool,
    path: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<std::sync::Mutex<WatchState>>();
    let mut guard = state
        .lock()
        .map_err(|_| "監視状態をロックできません".to_string())?;

    stop_watch(&mut guard);

    if !enabled {
        return Ok(());
    }

    let Some(path_str) = path else {
        return Ok(());
    };

    let watch_path = PathBuf::from(&path_str);
    if !watch_path.is_dir() {
        return Err("フォルダではありません".to_string());
    }

    let (tx, rx) = mpsc::channel();
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if res.is_ok() {
                let _ = tx.send(());
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("ファイル監視を開始できません: {e}"))?;

    watcher
        .watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("フォルダを監視できません: {e}"))?;

    guard.watcher = Some(watcher);

    std::thread::spawn(move || {
        let debounce = Duration::from_millis(300);
        while rx.recv().is_ok() {
            std::thread::sleep(debounce);
            while rx.try_recv().is_ok() {}
            let _ = app_handle.emit("workspace-files-changed", ());
        }
    });

    Ok(())
}
