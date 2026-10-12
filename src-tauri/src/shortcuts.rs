//! Global hotkeys (Ctrl+Alt+letter). Each one maps to a `notes` action.

use crate::{notes, windows};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Clone, Copy, Debug)]
pub enum Action {
    PasteNew,
    New,
    Delete,
    HideAll,
    ShowAll,
    ToggleOnTop,
}

pub const BINDINGS: &[(Code, &str, Action)] = &[
    (Code::KeyV, "Ctrl+Alt+V", Action::PasteNew),
    (Code::KeyN, "Ctrl+Alt+N", Action::New),
    (Code::KeyD, "Ctrl+Alt+D", Action::Delete),
    (Code::KeyH, "Ctrl+Alt+H", Action::HideAll),
    (Code::KeyS, "Ctrl+Alt+S", Action::ShowAll),
    (Code::KeyT, "Ctrl+Alt+T", Action::ToggleOnTop),
];

pub fn run(app: &AppHandle, action: Action) {
    let result = match action {
        Action::PasteNew => match app.clipboard().read_text() {
            // Plain text only, by design; no text on the clipboard → no note.
            Ok(text) if !text.is_empty() => notes::new_note(app, &text).map(|_| ()),
            _ => Ok(()),
        },
        Action::New => notes::new_note(app, "").map(|_| ()),
        Action::Delete => match windows::selected_visible(app) {
            Some(id) => notes::request_trash(app, &id),
            None => Ok(()),
        },
        Action::HideAll => {
            notes::hide_all(app);
            Ok(())
        }
        Action::ShowAll => {
            notes::show_all(app);
            Ok(())
        }
        Action::ToggleOnTop => match windows::selected_visible(app) {
            Some(id) => notes::toggle_on_top(app, &id).map(|_| ()),
            None => Ok(()),
        },
    };
    if let Err(e) = result {
        eprintln!("hotkey {action:?} failed: {e}");
    }
}

/// Register all hotkeys. Returns the display names of any that could not be
/// registered (usually because another app owns them).
pub fn register(app: &AppHandle) -> Vec<&'static str> {
    let gs = app.global_shortcut();
    let mut failed = Vec::new();
    for &(code, name, action) in BINDINGS {
        let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), code);
        let result = gs.on_shortcut(shortcut, move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                run(app, action);
            }
        });
        if let Err(e) = result {
            eprintln!("could not register {name}: {e}");
            failed.push(name);
        }
    }
    failed
}
