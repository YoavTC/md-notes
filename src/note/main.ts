// A single sticky-note window: title bar + editor + debounced saving.

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, Color, COLORS, NoteMeta } from "../api";
import { createEditor } from "../editor";

const SAVE_DELAY_MS = 400;

const win = getCurrentWindow();
const id = win.label.replace(/^note-/, "");
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// --- saving -----------------------------------------------------------------

let pending: string | null = null;
let timer: number | undefined;
let chain: Promise<void> = Promise.resolve();

function scheduleSave(doc: string) {
  pending = doc;
  $("#dirty").hidden = false;
  clearTimeout(timer);
  timer = window.setTimeout(flush, SAVE_DELAY_MS);
}

/** Save any pending edit now. Saves run strictly in order. */
function flush(): Promise<void> {
  clearTimeout(timer);
  if (pending === null) return chain;
  const doc = pending;
  pending = null;
  chain = chain
    .then(() => api.saveNote(id, doc))
    .then(() => {
      if (pending === null) $("#dirty").hidden = true;
    })
    .catch((e) => {
      console.error("save failed", e);
      // Keep the edit so the next flush retries it.
      if (pending === null) pending = doc;
      $("#dirty").title = `Not saved: ${e}`;
    });
  return chain;
}

// --- appearance -------------------------------------------------------------

function applyMeta(meta: Pick<NoteMeta, "color" | "alwaysOnTop">) {
  document.body.dataset.color = meta.color;
  const pin = $("#pin");
  pin.setAttribute("aria-pressed", String(meta.alwaysOnTop));
  pin.classList.toggle("on", meta.alwaysOnTop);
}

const palette = $("#palette");
function togglePalette(show = palette.hidden) {
  palette.hidden = !show;
  $("#color").setAttribute("aria-expanded", String(show));
}

for (const color of COLORS) {
  const swatch = document.createElement("button");
  swatch.className = "swatch";
  swatch.dataset.swatch = color;
  swatch.title = color[0].toUpperCase() + color.slice(1);
  swatch.setAttribute("role", "menuitem");
  swatch.addEventListener("click", async () => {
    togglePalette(false);
    document.body.dataset.color = color;
    await api.setColor(id, color as Color);
    editor.focus();
  });
  palette.append(swatch);
}

// --- actions ----------------------------------------------------------------

async function closeNote() {
  await flush();
  await api.closeNote(id);
}

async function trashNote() {
  await flush();
  await api.trashNote(id);
}

function openLink(href: string) {
  openUrl(href).catch((e) => console.error("open link failed", e));
}

// --- startup ----------------------------------------------------------------

const { meta, content } = await api.loadNote(id);
applyMeta(meta);

const editor = createEditor({
  parent: $("#editor"),
  doc: content,
  onChange: scheduleSave,
  onOpenLink: openLink,
  extraKeys: [
    { key: "Mod-s", run: () => (flush(), true) },
    { key: "Mod-n", run: () => (api.newNote(), true) },
    {
      key: "Escape",
      run: () => {
        if (palette.hidden) return false;
        togglePalette(false);
        return true;
      },
    },
  ],
});
editor.focus();
// Put the cursor at the end so new notes and pasted notes are ready to type.
editor.dispatch({ selection: { anchor: editor.state.doc.length }, scrollIntoView: true });

$("#new").addEventListener("click", () => api.newNote());
$("#color").addEventListener("click", () => togglePalette());
$("#pin").addEventListener("click", async () => {
  const on = await api.toggleOnTop(id);
  applyMeta({ color: document.body.dataset.color as Color, alwaysOnTop: on });
});
$("#trash").addEventListener("click", trashNote);
$("#close").addEventListener("click", closeNote);

// Keep keyboard focus in the editor when title-bar buttons are clicked.
for (const b of document.querySelectorAll<HTMLButtonElement>("#bar button")) {
  b.addEventListener("mousedown", (e) => e.preventDefault());
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !palette.hidden) togglePalette(false);
});
document.addEventListener("mousedown", (e) => {
  const t = e.target as HTMLElement;
  if (!palette.hidden && !t.closest("#palette, #color")) togglePalette(false);
});

await win.listen<NoteMeta>("meta-changed", (e) => {
  if (e.payload.id === id) applyMeta(e.payload);
});
await listen("flush", () => flush());
window.addEventListener("blur", () => flush());
await win.onCloseRequested(async () => {
  // Alt+F4 and the like: save before the window goes away.
  await flush();
});
