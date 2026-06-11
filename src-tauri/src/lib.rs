mod commands;
mod csv;
mod dir;
mod fonts;
mod lifecycle;
mod memory;
mod recent;
mod search;
mod tray;
mod watch;
mod workspace;

use csv::{CsvRegistry, CsvState};
use std::sync::Mutex;
use tauri::Manager;
use watch::WatchState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(CsvState(Mutex::new(CsvRegistry::new())));
            tray::setup_tray(app.handle())?;
            Ok(())
        })
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
            commands::suspend_app_resources,
            commands::refresh_tray_menu,
            commands::csv_open,
            commands::csv_read_rows,
            commands::csv_set_cell,
            commands::csv_save,
            commands::csv_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
