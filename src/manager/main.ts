// Notes list, trash and global settings.

import { listen } from "@tauri-apps/api/event";
import { api, NoteSummary } from "../api";
import { DEFAULT_SETTINGS, formatDate, initSettings, saveSettings, Settings } from "../settings";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
type Tab = "notes" | "trash" | "settings";
let tab: Tab = "notes";

const HINTS: Record<Tab, string> = {
  notes: "Ctrl+Alt+N new · Ctrl+Alt+V paste · Ctrl+Alt+H/S hide/show all",
  trash: "Deleted notes are removed permanently after 30 days.",
  settings: "Changes are saved and applied to open notes immediately.",
};

function when(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const TRASH_ICON =
  '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>';

function row(note: NoteSummary) {
  const li = document.createElement("li");
  li.dataset.color = note.color;

  const swatch = document.createElement("span");
  swatch.className = "swatch";

  const text = document.createElement("div");
  text.className = "text";
  const title = document.createElement("span");
  title.className = "title";
  title.dir = "auto";
  title.textContent = note.title || "Empty note";
  if (!note.title) title.classList.add("untitled");
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent =
    tab === "trash"
      ? `Deleted ${when(note.deletedAt ?? note.modified)}`
      : `${when(note.modified)} · ${note.open ? (note.hidden ? "hidden" : "open") : "closed"}`;
  text.append(title, sub);

  li.append(swatch, text);

  if (tab === "trash") {
    const restore = document.createElement("button");
    restore.className = "restore";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => api.restoreNote(note.id));
    li.append(restore);
  } else {
    li.tabIndex = 0;
    li.title = "Open note";
    const open = () => api.openNote(note.id);
    li.addEventListener("click", open);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
      if (e.key === "Delete") api.requestTrash(note.id);
    });

    const trash = document.createElement("button");
    trash.className = "trash";
    trash.title = "Move to trash (Del)";
    trash.setAttribute("aria-label", "Move to trash");
    trash.innerHTML = TRASH_ICON;
    trash.addEventListener("click", (e) => {
      e.stopPropagation();
      api.requestTrash(note.id);
    });
    li.append(trash);
  }
  return li;
}

// The list is only rebuilt when its data changed, and never while a mouse
// button is down: rebuilding replaced the row under the pointer mid-click
// (the click that focuses the window triggers a refresh), losing the click.
let lastRendered = "";
let pointerDown = false;
let renderDeferred = false;
document.addEventListener("pointerdown", () => (pointerDown = true), true);
document.addEventListener(
  "pointerup",
  () =>
    // After the click has been dispatched.
    setTimeout(() => {
      pointerDown = false;
      if (renderDeferred) {
        renderDeferred = false;
        render();
      }
    }),
  true,
);

async function render() {
  if (tab === "settings") return;
  const shown = tab;
  const notes = shown === "notes" ? await api.listNotes() : await api.listTrash();
  if (tab !== shown) return;
  if (pointerDown) {
    renderDeferred = true;
    return;
  }
  const key = shown + JSON.stringify(notes);
  if (key === lastRendered) return;
  lastRendered = key;

  const focusedId = (document.activeElement as HTMLElement | null)?.closest("li")?.dataset.id;
  const rows = notes.map((n) => {
    const li = row(n);
    li.dataset.id = n.id;
    return li;
  });
  $("#list").replaceChildren(...rows);
  rows.find((r) => r.dataset.id === focusedId)?.focus();
  const empty = $("#empty");
  empty.hidden = notes.length > 0;
  empty.textContent = shown === "notes" ? "No notes yet." : "Trash is empty.";
}

function select(next: Tab) {
  tab = next;
  for (const t of ["notes", "trash", "settings"] as const) {
    $(`#tab-${t}`).setAttribute("aria-selected", String(t === tab));
  }
  const isSettings = tab === "settings";
  $("#list").hidden = isSettings;
  $("#settings").hidden = !isSettings;
  if (isSettings) $("#empty").hidden = true;
  $("#hint").textContent = HINTS[tab];
  lastRendered = "";
  render();
}

// --- settings ---------------------------------------------------------------

const form = $<HTMLFormElement>("#settings");
const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as unknown as T;
let current: Settings = DEFAULT_SETTINGS;

function fillForm(s: Settings) {
  current = s;
  const set = (name: string, value: string) => {
    const el = field<HTMLInputElement>(name);
    // Don't fight the user while they're typing in a field.
    if (document.activeElement !== el) el.value = value;
  };
  set("scale", String(s.scale));
  field<HTMLOutputElement>("scaleOut").value = `${s.scale.toFixed(2)}×`;
  field<HTMLInputElement>("animations").checked = s.animations;
  set("font", s.font);
  set("monoFont", s.monoFont);
  set("dateFormat", s.dateFormat);
  updatePreview();
  updateFontSample();
}

/** Show the chosen fonts in the sample (this window itself keeps the UI font). */
function updateFontSample() {
  const sample = $("#font-sample");
  const font = field<HTMLInputElement>("font").value.trim() || current.font;
  const mono = field<HTMLInputElement>("monoFont").value.trim() || current.monoFont;
  sample.style.fontFamily = `${JSON.stringify(font)}, "Segoe UI", sans-serif`;
  sample.querySelector("code")!.style.fontFamily = `${JSON.stringify(mono)}, "Cascadia Mono", monospace`;
}

function updatePreview() {
  const fmt = field<HTMLInputElement>("dateFormat").value || current.dateFormat;
  field<HTMLOutputElement>("datePreview").value = `Example: ${formatDate(Date.now(), fmt)}`;
}

function readForm(): Settings {
  return {
    ...current,
    scale: Number(field<HTMLInputElement>("scale").value),
    animations: field<HTMLInputElement>("animations").checked,
    font: field<HTMLInputElement>("font").value,
    monoFont: field<HTMLInputElement>("monoFont").value,
    dateFormat: field<HTMLInputElement>("dateFormat").value,
  };
}

let saveTimer: number | undefined;
function save(delay: number) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => fillForm(await saveSettings(readForm())), delay);
}

form.addEventListener("input", (e) => {
  const name = (e.target as HTMLInputElement).name;
  if (name === "scale") {
    field<HTMLOutputElement>("scaleOut").value = `${Number(field<HTMLInputElement>("scale").value).toFixed(2)}×`;
  }
  if (name === "dateFormat") updatePreview();
  if (name === "font" || name === "monoFont") updateFontSample();
  // Text fields wait for a pause in typing; the slider applies on release (change).
  if (name !== "scale") save(name === "animations" ? 0 : 350);
});
form.addEventListener("change", (e) => {
  if ((e.target as HTMLInputElement).name === "scale") save(0);
});
form.addEventListener("submit", (e) => e.preventDefault());
// Invalid fonts fall back to defaults on save; show that once the field is left.
form.addEventListener("focusout", () => setTimeout(() => fillForm(current)));
$("#reset").addEventListener("click", async () => {
  fillForm(await saveSettings({ ...DEFAULT_SETTINGS, autostart: current.autostart }));
});

// --- startup ----------------------------------------------------------------

$("#tab-notes").addEventListener("click", () => select("notes"));
$("#tab-trash").addEventListener("click", () => select("trash"));
$("#tab-settings").addEventListener("click", () => select("settings"));
$("#new").addEventListener("click", () => api.newNote());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});

fillForm(await initSettings(fillForm, { fonts: false }));
await listen("notes-changed", render);
window.addEventListener("focus", render);
select("notes");
