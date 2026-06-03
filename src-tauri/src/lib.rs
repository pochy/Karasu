mod commands;
mod dir;
mod fonts;
mod recent;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::get_recent_path,
            commands::list_system_fonts,
            commands::list_directory,
            commands::get_workspace_root,
            commands::set_workspace_root,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
