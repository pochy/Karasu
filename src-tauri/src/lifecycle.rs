use crate::csv::{close_all_sessions, CsvState};
use crate::memory;
use crate::watch;
use tauri::AppHandle;

pub fn suspend_app(app: &AppHandle, csv: &CsvState) -> Result<(), String> {
    close_all_sessions(csv)?;
    watch::set_workspace_watch(app, false, None)?;
    memory::trim_process_heap();
    Ok(())
}
