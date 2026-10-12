mod commands;
mod notes;
mod shortcuts;
mod store;
mod tray;
mod windows;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_autostart::ManagerExt;

pub struct AppState {
    pub store: Mutex<store::Store>,
    /// Most recently focused note window; the target of Delete / Toggle-on-top.
    pub selected: Mutex<Option<String>>,
    /// Set while quitting so closing windows doesn't mark notes closed.
    pub quitting: AtomicBool,
}

/// `%APPDATA%\md-notes`, or `MD_NOTES_DATA_DIR` (used by tests).
fn data_root(app: &AppHandle) -> PathBuf {
    if let Some(dir) = std::env::var_os("MD_NOTES_DATA_DIR") {
        return dir.into();
    }
    app.path()
        .data_dir()
        .expect("no data dir")
        .join("md-notes")
}

/// Set (or with `None`, toggle) "Start with Windows". Only touches the
/// registry in release builds so dev runs don't register the dev binary.
pub fn set_autostart(app: &AppHandle, on: Option<bool>) {
    let on = {
        let state = app.state::<AppState>();
        let mut store = state.store.lock().unwrap();
        let on = on.unwrap_or(!store.settings().autostart);
        store.set_autostart(on);
        let _ = store.flush();
        on
    };
    if cfg!(debug_assertions) {
        return;
    }
    let launcher = app.autolaunch();
    let result = match (on, launcher.is_enabled().unwrap_or(false)) {
        (true, false) => launcher.enable(),
        (false, true) => launcher.disable(),
        _ => Ok(()),
    };
    if let Err(e) = result {
        eprintln!("autostart update failed: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just shows the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            notes::show_all(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let root = data_root(&handle);
            let store = store::Store::open(&root)
                .map_err(|e| format!("cannot open notes at {}: {e}", root.display()))?;
            let autostart = store.settings().autostart;
            app.manage(AppState {
                store: Mutex::new(store),
                selected: Mutex::new(None),
                quitting: AtomicBool::new(false),
            });

            // Geometry changes only mark the index dirty; write it in batches.
            let flusher = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(500));
                let state = flusher.state::<AppState>();
                if let Err(e) = state.store.lock().unwrap().flush() {
                    eprintln!("index flush failed: {e}");
                }
            });

            set_autostart(&handle, Some(autostart));
            let failed = shortcuts::register(&handle);
            tray::build(&handle, &failed)?;
            notes::startup(&handle);
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::load_note,
            commands::save_note,
            commands::new_note,
            commands::open_note,
            commands::restore_note,
            commands::close_note,
            commands::trash_note,
            commands::request_trash,
            commands::get_settings,
            commands::set_settings,
            commands::toggle_on_top,
            commands::set_color,
            commands::list_notes,
            commands::list_trash,
            commands::show_manager,
            commands::hide_all,
            commands::show_all,
            commands::selected_note,
        ])
        .build(tauri::generate_context!())
        .expect("error while building application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { code, api, .. } = event {
                // Closing the last window keeps the app alive in the tray;
                // only an explicit quit (code set) exits.
                if code.is_none() {
                    api.prevent_exit();
                } else {
                    let _ = app.state::<AppState>().store.lock().unwrap().flush();
                }
            }
        });
}
