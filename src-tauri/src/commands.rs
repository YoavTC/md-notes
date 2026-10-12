//! Tauri commands: thin wrappers over `notes` and `store` for the frontend.
//! Commands that create windows are async; synchronous commands that build
//! windows deadlock on Windows.

use crate::notes::{self, Result};
use crate::store::{self, NoteMeta};
use crate::{windows, AppState};
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedNote {
    meta: NoteMeta,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    id: String,
    title: String,
    color: String,
    modified: u64,
    open: bool,
    hidden: bool,
    deleted_at: Option<u64>,
}

fn summarize(s: &store::Store, m: &NoteMeta) -> NoteSummary {
    NoteSummary {
        id: m.id.clone(),
        title: store::title_of(&s.read(&m.id).unwrap_or_default()),
        color: m.color.clone(),
        modified: m.modified,
        open: m.open,
        hidden: m.hidden,
        deleted_at: m.deleted_at,
    }
}

#[tauri::command]
pub fn load_note(state: State<AppState>, id: String) -> Result<LoadedNote> {
    let store = state.store.lock().unwrap();
    let meta = store.get(&id).cloned().ok_or("no such note")?;
    let content = store.read(&id).map_err(|e| e.to_string())?;
    Ok(LoadedNote { meta, content })
}

#[tauri::command]
pub fn save_note(state: State<AppState>, id: String, content: String) -> Result<()> {
    state.store.lock().unwrap().write(&id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn new_note(app: AppHandle, content: Option<String>) -> Result<String> {
    notes::new_note(&app, content.as_deref().unwrap_or(""))
}

#[tauri::command]
pub async fn open_note(app: AppHandle, id: String) -> Result<()> {
    notes::open_note(&app, &id)
}

#[tauri::command]
pub async fn restore_note(app: AppHandle, id: String) -> Result<()> {
    notes::restore_note(&app, &id)
}

#[tauri::command]
pub fn close_note(app: AppHandle, id: String) -> Result<()> {
    notes::close_note(&app, &id)
}

#[tauri::command]
pub fn trash_note(app: AppHandle, id: String) -> Result<()> {
    notes::trash_note(&app, &id)
}

#[tauri::command]
pub fn toggle_on_top(app: AppHandle, id: String) -> Result<bool> {
    notes::toggle_on_top(&app, &id)
}

#[tauri::command]
pub fn set_color(app: AppHandle, id: String, color: String) -> Result<()> {
    notes::set_color(&app, &id, &color)
}

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> Vec<NoteSummary> {
    let store = state.store.lock().unwrap();
    let mut list: Vec<NoteSummary> = store.notes().iter().map(|m| summarize(&store, m)).collect();
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    list
}

#[tauri::command]
pub fn list_trash(state: State<AppState>) -> Vec<NoteSummary> {
    let store = state.store.lock().unwrap();
    let mut list: Vec<NoteSummary> = store.trash().iter().map(|m| summarize(&store, m)).collect();
    list.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    list
}

#[tauri::command]
pub async fn show_manager(app: AppHandle) -> Result<()> {
    windows::show_manager(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_all(app: AppHandle) {
    notes::hide_all(&app)
}

#[tauri::command]
pub async fn show_all(app: AppHandle) {
    notes::show_all(&app)
}

/// The note the global hotkeys act on (for tests and diagnostics).
#[tauri::command]
pub fn selected_note(app: AppHandle) -> Option<String> {
    windows::selected_visible(&app)
}
