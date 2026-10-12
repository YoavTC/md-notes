// Notes list + trash.

import { listen } from "@tauri-apps/api/event";
import { api, NoteSummary } from "../api";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
let tab: "notes" | "trash" = "notes";

function when(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function row(note: NoteSummary) {
  const li = document.createElement("li");
  li.dataset.color = note.color;

  const swatch = document.createElement("span");
  swatch.className = "swatch";

  const text = document.createElement("div");
  text.className = "text";
  const title = document.createElement("span");
  title.className = "title";
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
    });
  }
  return li;
}

async function render() {
  const notes = tab === "notes" ? await api.listNotes() : await api.listTrash();
  $("#list").replaceChildren(...notes.map(row));
  const empty = $("#empty");
  empty.hidden = notes.length > 0;
  empty.textContent = tab === "notes" ? "No notes yet." : "Trash is empty.";
  $("#hint").textContent =
    tab === "trash"
      ? "Deleted notes are removed permanently after 30 days."
      : "Ctrl+Alt+N new · Ctrl+Alt+V paste · Ctrl+Alt+H/S hide/show all";
}

function select(next: typeof tab) {
  tab = next;
  $("#tab-notes").setAttribute("aria-selected", String(tab === "notes"));
  $("#tab-trash").setAttribute("aria-selected", String(tab === "trash"));
  render();
}

$("#tab-notes").addEventListener("click", () => select("notes"));
$("#tab-trash").addEventListener("click", () => select("trash"));
$("#new").addEventListener("click", () => api.newNote());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});

await listen("notes-changed", render);
window.addEventListener("focus", render);
render();
