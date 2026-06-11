use crate::recent;
use crate::workspace;
use image::imageops::FilterType;
use std::io;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_dialog::DialogExt;

const ID_SHOW: &str = "tray.show";
const ID_WORKSPACE: &str = "tray.open_workspace";
const ID_QUIT: &str = "tray.quit";
const ID_RECENT_PREFIX: &str = "tray.recent.";
const ID_RECENT_EMPTY: &str = "tray.recent.empty";
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");
const TRAY_ICON_SIZE: u32 = 22;

pub struct TrayIconStore(pub Mutex<Option<TrayIcon>>);

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn menu_label_for_path(path: &str) -> String {
    let name = file_name(path);
    if name.chars().count() > 40 {
        let trimmed: String = name.chars().take(37).collect();
        format!("{trimmed}…")
    } else {
        name.to_string()
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_icon_image() -> tauri::Result<tauri::image::Image<'static>> {
    let decoded = image::load_from_memory(TRAY_ICON_BYTES)
        .map_err(|e| io::Error::other(format!("failed to decode tray icon: {e}")))?;
    let rgba = decoded
        .resize_exact(TRAY_ICON_SIZE, TRAY_ICON_SIZE, FilterType::Lanczos3)
        .to_rgba8()
        .into_raw();

    Ok(tauri::image::Image::new_owned(
        rgba,
        TRAY_ICON_SIZE,
        TRAY_ICON_SIZE,
    ))
}

pub fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let recent_paths = recent::load_recent_paths(app);
    let recent_submenu = if recent_paths.is_empty() {
        let empty_item =
            MenuItem::with_id(app, ID_RECENT_EMPTY, "（なし）", false, None::<&str>)?;
        let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = vec![&empty_item];
        Submenu::with_id_and_items(app, "tray.recent", "最近のファイル", true, &refs)?
    } else {
        let items: Vec<MenuItem<Wry>> = recent_paths
            .iter()
            .enumerate()
            .map(|(i, path)| {
                MenuItem::with_id(
                    app,
                    format!("{ID_RECENT_PREFIX}{i}"),
                    menu_label_for_path(path),
                    true,
                    None::<&str>,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items
            .iter()
            .map(|item| item as &dyn tauri::menu::IsMenuItem<Wry>)
            .collect();
        Submenu::with_id_and_items(app, "tray.recent", "最近のファイル", true, &refs)?
    };

    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, ID_SHOW, "Karasu を表示", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                ID_WORKSPACE,
                "作業フォルダを開く…",
                true,
                None::<&str>,
            )?,
            &recent_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, ID_QUIT, "終了", true, None::<&str>)?,
        ],
    )
}

pub fn refresh_tray_menu(app: &AppHandle) {
    let Ok(menu) = build_tray_menu(app) else {
        return;
    };
    let tray = {
        let state = app.state::<TrayIconStore>();
        state.0.lock().ok().and_then(|guard| guard.clone())
    };
    if let Some(tray) = tray {
        let _ = tray.set_menu(Some(menu));
    }
}

fn open_recent_from_tray(app: &AppHandle, index: usize) {
    let paths = recent::load_recent_paths(app);
    let Some(path) = paths.get(index) else {
        return;
    };
    show_main_window(app);
    let _ = app.emit("tray-open-file", path.clone());
}

fn open_workspace_from_tray(app: &AppHandle) {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(folder) = picked else {
        return;
    };
    let Ok(path_buf) = folder.into_path() else {
        let _ = app.emit("tray-error", "作業フォルダのパスを取得できません");
        return;
    };
    if let Err(e) = workspace::save_workspace_root(app, path_buf.as_path()) {
        let _ = app.emit("tray-error", e);
        return;
    }
    let path = path_buf.to_string_lossy().into_owned();
    show_main_window(app);
    let _ = app.emit("tray-workspace-opened", path);
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    if id == ID_SHOW {
        show_main_window(app);
        return;
    }
    if id == ID_WORKSPACE {
        open_workspace_from_tray(app);
        return;
    }
    if id == ID_QUIT {
        app.exit(0);
        return;
    }
    if id == ID_RECENT_EMPTY {
        return;
    }
    if let Some(index_str) = id.strip_prefix(ID_RECENT_PREFIX) {
        if let Ok(index) = index_str.parse::<usize>() {
            open_recent_from_tray(app, index);
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;
    let icon = tray_icon_image()?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .icon_as_template(false)
        .tooltip("Karasu")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                refresh_tray_menu(tray.app_handle());
            }
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayIconStore(Mutex::new(Some(tray))));
    Ok(())
}
