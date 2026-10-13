//! Application-level note actions shared by commands, tray and hotkeys.
//! Each action updates the store first, releases the lock, then touches
//! windows (window events re-enter the store lock).

use crate::store::{self, NoteMeta, COLORS};
use crate::windows;
use crate::AppState;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub type Result<T> = std::result::Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn with_store<T>(app: &AppHandle, f: impl FnOnce(&mut store::Store) -> T) -> T {
    let state = app.state::<AppState>();
    let mut store = state.store.lock().unwrap();
    f(&mut store)
}

/// Tell the manager (and anything else listening) that the note list changed.
pub fn notes_changed(app: &AppHandle) {
    let _ = app.emit("notes-changed", ());
}

/// Push updated metadata to the note's own window.
fn meta_changed(app: &AppHandle, meta: &NoteMeta) {
    if let Some(win) = windows::note_window(app, &meta.id) {
        let _ = win.emit_to(win.label(), "meta-changed", meta);
    }
}

pub fn new_note(app: &AppHandle, content: &str) -> Result<String> {
    let meta = with_store(app, |s| s.create(content)).map_err(err)?;
    windows::open_window(app, &meta, true).map_err(err)?;
    notes_changed(app);
    Ok(meta.id)
}

/// Reopen a closed note, or bring an open one to the front.
pub fn open_note(app: &AppHandle, id: &str) -> Result<()> {
    let meta = with_store(app, |s| {
        let m = s.update(id, |m| {
            m.open = true;
            m.hidden = false;
        });
        let _ = s.flush();
        m
    })
    .ok_or("no such note")?;
    windows::open_window(app, &meta, true).map_err(err)?;
    notes_changed(app);
    Ok(())
}

/// Close a note's window. Content is kept; `open` is cleared by the window's
/// Destroyed handler.
pub fn close_note(app: &AppHandle, id: &str) -> Result<()> {
    if let Some(win) = windows::note_window(app, id) {
        win.destroy().map_err(err)?;
    }
    Ok(())
}

pub fn trash_note(app: &AppHandle, id: &str) -> Result<()> {
    with_store(app, |s| s.trash_note(id)).map_err(err)?;
    if let Some(win) = windows::note_window(app, id) {
        win.destroy().map_err(err)?;
    }
    notes_changed(app);
    Ok(())
}

/// Trash a note from outside its window (manager, hotkey). An open note is
/// asked to trash itself so it can save pending edits first.
pub fn request_trash(app: &AppHandle, id: &str) -> Result<()> {
    match windows::note_window(app, id) {
        Some(win) => win.emit_to(win.label(), "trash-self", ()).map_err(err),
        None => trash_note(app, id),
    }
}

pub fn restore_note(app: &AppHandle, id: &str) -> Result<()> {
    let meta = with_store(app, |s| s.restore(id)).map_err(err)?;
    windows::open_window(app, &meta, true).map_err(err)?;
    notes_changed(app);
    Ok(())
}

pub fn toggle_on_top(app: &AppHandle, id: &str) -> Result<bool> {
    let meta = with_store(app, |s| s.update(id, |m| m.always_on_top = !m.always_on_top))
        .ok_or("no such note")?;
    if let Some(win) = windows::note_window(app, id) {
        win.set_always_on_top(meta.always_on_top).map_err(err)?;
    }
    meta_changed(app, &meta);
    Ok(meta.always_on_top)
}

pub fn set_color(app: &AppHandle, id: &str, color: &str) -> Result<()> {
    if !COLORS.contains(&color) {
        return Err(format!("unknown color {color}"));
    }
    let meta = with_store(app, |s| s.update(id, |m| m.color = color.to_string()))
        .ok_or("no such note")?;
    meta_changed(app, &meta);
    notes_changed(app);
    Ok(())
}

pub fn hide_all(app: &AppHandle) {
    let ids: Vec<String> = with_store(app, |s| {
        let ids: Vec<String> = s.notes().iter().filter(|n| n.open).map(|n| n.id.clone()).collect();
        for id in &ids {
            s.update(id, |m| m.hidden = true);
        }
        ids
    });
    for id in ids {
        if let Some(win) = windows::note_window(app, &id) {
            let _ = win.emit_to(win.label(), "flush", ());
            let _ = win.hide();
        }
    }
}

/// Show every note: hidden ones reappear and closed ones reopen, restoring
/// saved geometry and always-on-top. Existing windows are reused, never
/// duplicated.
pub fn show_all(app: &AppHandle) {
    let metas = with_store(app, |s| {
        let metas = s.reveal_all();
        let _ = s.flush();
        metas
    });
    let selected = app.state::<AppState>().selected.lock().unwrap().clone();
    for meta in &metas {
        if let Err(e) = windows::open_window(app, meta, false) {
            eprintln!("could not show note {}: {e}", meta.id);
        }
    }
    let focus = selected
        .filter(|id| metas.iter().any(|m| &m.id == id))
        .or_else(|| metas.last().map(|m| m.id.clone()));
    if let Some(win) = focus.and_then(|id| windows::note_window(app, &id)) {
        let _ = win.set_focus();
    }
    notes_changed(app);
}

/// Open notes left open last session; create a first note on a fresh install.
pub fn startup(app: &AppHandle) {
    let (metas, fresh) = with_store(app, |s| {
        if let Err(e) = s.purge_trash(store::now_ms(), store::TRASH_MAX_AGE_MS) {
            eprintln!("trash purge failed: {e}");
        }
        let metas: Vec<NoteMeta> = s.notes().iter().filter(|n| n.open).cloned().collect();
        (metas, s.notes().is_empty() && s.trash().is_empty())
    });
    if fresh {
        if let Err(e) = new_note(app, "") {
            eprintln!("could not create first note: {e}");
        }
        return;
    }
    for meta in &metas {
        if let Err(e) = windows::open_window(app, meta, false) {
            eprintln!("could not restore note {}: {e}", meta.id);
        }
    }
}

pub fn settings(app: &AppHandle) -> store::Settings {
    with_store(app, |s| s.settings().clone())
}

/// Save new settings and apply them to every window.
pub fn set_settings(app: &AppHandle, settings: store::Settings) -> store::Settings {
    let saved = with_store(app, |s| {
        let saved = s.set_settings(settings);
        let _ = s.flush();
        saved
    });
    // Scale applies to notes only, not the notes manager.
    for (label, win) in app.webview_windows() {
        if windows::id_of(&label).is_some() {
            let _ = win.set_zoom(saved.scale);
        }
    }
    let _ = app.emit("settings-changed", &saved);
    saved
}

/// Quit for real: ask note windows to save pending edits, give them a moment,
/// flush the index, exit. Notes stay `open` for the next launch.
pub fn quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.quitting.store(true, Ordering::SeqCst);
    let _ = app.emit("flush", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let state = app.state::<AppState>();
        if let Err(e) = state.store.lock().unwrap().flush() {
            eprintln!("index flush failed on quit: {e}");
        }
        app.exit(0);
    });
}
