//! Note window lifecycle: creation, placement, geometry tracking and
//! selected-note tracking. Knows nothing about tray or hotkeys.

use crate::store::NoteMeta;
use crate::AppState;
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

pub const MANAGER_LABEL: &str = "manager";
const NOTE_PREFIX: &str = "note-";

pub fn label_of(id: &str) -> String {
    format!("{NOTE_PREFIX}{id}")
}

pub fn id_of(label: &str) -> Option<&str> {
    label.strip_prefix(NOTE_PREFIX)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

/// Is a window at `pos` (physical) with physical width `width` still
/// reachable? We require a grab point near the left of its title bar to lie on
/// some monitor, so the user can always drag it back.
pub fn is_reachable(pos: (i32, i32), width: i32, monitors: &[Rect]) -> bool {
    let probe = (pos.0 + (width / 2).min(40), pos.1 + 8);
    monitors.iter().any(|m| m.contains(probe.0, probe.1))
}

/// Default spot for a note without a usable saved position: near the centre of
/// the work area, cascaded so new notes don't stack exactly.
pub fn default_position(work: Rect, size: (i32, i32), cascade: i32) -> (i32, i32) {
    let step = 28 * (cascade % 8);
    (
        work.x + (work.w - size.0) / 2 + step,
        work.y + (work.h - size.1) / 3 + step,
    )
}

fn monitor_rects(win: &WebviewWindow) -> Vec<Rect> {
    win.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect {
                x: a.position.x,
                y: a.position.y,
                w: a.size.width as i32,
                h: a.size.height as i32,
            }
        })
        .collect()
}

fn place(win: &WebviewWindow, meta: &NoteMeta, cascade: i32) -> tauri::Result<()> {
    let monitors = monitor_rects(win);
    let scale = win.scale_factor().unwrap_or(1.0);
    let phys_w = (meta.w * scale) as i32;
    let saved = meta.x.zip(meta.y);
    match saved {
        Some(pos) if is_reachable(pos, phys_w, &monitors) => {
            win.set_position(PhysicalPosition::new(pos.0, pos.1))?;
        }
        _ => {
            let work = win
                .primary_monitor()?
                .map(|m| {
                    let a = m.work_area();
                    Rect { x: a.position.x, y: a.position.y, w: a.size.width as i32, h: a.size.height as i32 }
                })
                .or_else(|| monitors.first().copied())
                .unwrap_or(Rect { x: 0, y: 0, w: 1280, h: 800 });
            let phys_h = (meta.h * scale) as i32;
            let (x, y) = default_position(work, (phys_w, phys_h), cascade);
            win.set_position(PhysicalPosition::new(x, y))?;
        }
    }
    // Re-apply the logical size: moving onto a monitor with another scale
    // factor rescales the window.
    win.set_size(LogicalSize::new(meta.w, meta.h))?;
    Ok(())
}

/// Show the note's window, creating it if needed. Never creates duplicates.
/// The caller must not hold the store lock (window events lock it).
pub fn open_window(app: &AppHandle, meta: &NoteMeta, focus: bool) -> tauri::Result<WebviewWindow> {
    let label = label_of(&meta.id);
    if let Some(win) = app.get_webview_window(&label) {
        if !meta.hidden {
            win.show()?;
            if focus {
                win.set_focus()?;
            }
        }
        return Ok(win);
    }

    let cascade = app.webview_windows().len() as i32;
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("note.html".into()))
        .title("Note")
        .decorations(false)
        .inner_size(meta.w, meta.h)
        .min_inner_size(160.0, 90.0)
        .skip_taskbar(true)
        .always_on_top(meta.always_on_top)
        .visible(false)
        .focused(focus)
        .build()?;
    apply_zoom(app, &win);
    place(&win, meta, cascade)?;
    // Remember where it actually landed (Moved is ignored while invisible).
    if let Ok(p) = win.outer_position() {
        let state = app.state::<AppState>();
        state.store.lock().unwrap().update(&meta.id, |m| {
            m.x = Some(p.x);
            m.y = Some(p.y);
        });
    }
    if !meta.hidden {
        win.show()?;
        if focus {
            win.set_focus()?;
        }
    }
    Ok(win)
}

/// Apply the "scale" setting as webview zoom (note windows only).
fn apply_zoom(app: &AppHandle, win: &WebviewWindow) {
    let scale = app.state::<AppState>().store.lock().unwrap().settings().scale;
    if (scale - 1.0).abs() > f64::EPSILON {
        let _ = win.set_zoom(scale);
    }
}

pub fn note_window(app: &AppHandle, id: &str) -> Option<WebviewWindow> {
    app.get_webview_window(&label_of(id))
}

/// The selected note: the most recently focused note window, if it still
/// exists and is visible.
pub fn selected_visible(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let id = state.selected.lock().unwrap().clone()?;
    let win = note_window(app, &id)?;
    win.is_visible().unwrap_or(false).then_some(id)
}

pub fn show_manager(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(MANAGER_LABEL) {
        win.unminimize()?;
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, MANAGER_LABEL, WebviewUrl::App("manager.html".into()))
        .title("Notes")
        .inner_size(360.0, 480.0)
        .min_inner_size(280.0, 260.0)
        .center()
        .build()?;
    Ok(())
}

/// Track geometry, focus and closing of note windows.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let Some(id) = id_of(window.label()) else {
        return;
    };
    let app = window.app_handle();
    let state = app.state::<AppState>();
    match event {
        WindowEvent::Moved(p) => {
            if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(false) {
                return;
            }
            state.store.lock().unwrap().update(id, |m| {
                m.x = Some(p.x);
                m.y = Some(p.y);
            });
        }
        WindowEvent::Resized(size) => {
            if size.width == 0 || size.height == 0 || window.is_minimized().unwrap_or(false) {
                return;
            }
            let logical = size.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
            state.store.lock().unwrap().update(id, |m| {
                m.w = logical.width.round();
                m.h = logical.height.round();
            });
        }
        WindowEvent::Focused(true) => {
            *state.selected.lock().unwrap() = Some(id.to_string());
        }
        WindowEvent::Destroyed => {
            {
                let mut selected = state.selected.lock().unwrap();
                if selected.as_deref() == Some(id) {
                    *selected = None;
                }
            }
            // On quit, windows are torn down but the notes stay open for the
            // next launch.
            if !state.quitting.load(Ordering::SeqCst) {
                let mut store = state.store.lock().unwrap();
                store.update(id, |m| {
                    m.open = false;
                    m.hidden = false;
                });
                let _ = store.flush();
                drop(store);
                let _ = app.emit("notes-changed", ());
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEFT: Rect = Rect { x: -1920, y: 0, w: 1920, h: 1040 };
    const MAIN: Rect = Rect { x: 0, y: 0, w: 2560, h: 1400 };

    #[test]
    fn on_screen_positions_are_kept() {
        assert!(is_reachable((100, 100), 300, &[MAIN]));
        assert!(is_reachable((-1500, 200), 300, &[LEFT, MAIN]));
        // Mostly off the right edge but the grab point is still visible.
        assert!(is_reachable((2500, 100), 300, &[MAIN]));
    }

    #[test]
    fn positions_on_a_disconnected_monitor_are_rejected() {
        assert!(!is_reachable((-1500, 200), 300, &[MAIN]));
        assert!(!is_reachable((100, -50), 300, &[MAIN]));
        assert!(!is_reachable((100, 100), 300, &[]));
    }

    #[test]
    fn default_position_cascades_inside_work_area() {
        let a = default_position(MAIN, (300, 280), 0);
        let b = default_position(MAIN, (300, 280), 1);
        assert_eq!((b.0 - a.0, b.1 - a.1), (28, 28));
        assert!(is_reachable(a, 300, &[MAIN]));
        assert_eq!(default_position(MAIN, (300, 280), 8), a);
    }

    #[test]
    fn labels_round_trip() {
        assert_eq!(id_of(&label_of("abc-1")), Some("abc-1"));
        assert_eq!(id_of(MANAGER_LABEL), None);
    }
}
