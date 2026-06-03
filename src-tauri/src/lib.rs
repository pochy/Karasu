mod commands;
mod dir;
mod fonts;
mod recent;
mod search;
mod watch;
mod workspace;

use std::sync::Mutex;
use watch::WatchState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(WatchState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::get_recent_path,
            commands::get_recent_paths,
            commands::list_system_fonts,
            commands::list_directory,
            commands::get_workspace_root,
            commands::set_workspace_root,
            commands::search_filenames,
            commands::set_workspace_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
