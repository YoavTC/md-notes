//! Tray icon and menu.

use crate::{notes, windows, AppState};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn build(app: &AppHandle, failed_hotkeys: &[&str]) -> tauri::Result<()> {
    let autostart_on = app.state::<AppState>().store.lock().unwrap().settings().autostart;

    let new = MenuItem::with_id(app, "new", "New note\tCtrl+Alt+N", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show all\tCtrl+Alt+S", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide all\tCtrl+Alt+H", true, None::<&str>)?;
    let list = MenuItem::with_id(app, "manager", "Notes…", true, None::<&str>)?;
    let autostart =
        CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&new, &show, &hide, &list, &sep1, &autostart, &sep2, &quit])?;
    for (i, name) in failed_hotkeys.iter().enumerate() {
        let item = MenuItem::with_id(
            app,
            format!("failed-{i}"),
            format!("{name} unavailable (in use by another app)"),
            false,
            None::<&str>,
        )?;
        menu.insert(&item, 0)?;
    }

    let mut tooltip = "Markdown Sticky Notes".to_string();
    if !failed_hotkeys.is_empty() {
        tooltip.push_str(&format!(" — hotkeys unavailable: {}", failed_hotkeys.join(", ")));
    }

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip(tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new" => {
                if let Err(e) = notes::new_note(app, "") {
                    eprintln!("new note failed: {e}");
                }
            }
            "show" => notes::show_all(app),
            "hide" => notes::hide_all(app),
            "manager" => {
                let _ = windows::show_manager(app);
            }
            "autostart" => crate::set_autostart(app, None),
            "quit" => notes::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let any_notes = !app
                    .state::<AppState>()
                    .store
                    .lock()
                    .unwrap()
                    .notes()
                    .is_empty();
                if any_notes {
                    notes::show_all(app);
                } else {
                    let _ = windows::show_manager(app);
                }
            }
        })
        .build(app)?;
    Ok(())
}
