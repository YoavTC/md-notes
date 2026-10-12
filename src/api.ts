// Typed wrappers over the Rust commands.

import { invoke } from "@tauri-apps/api/core";

export const COLORS = ["white", "gray", "blue", "yellow", "green", "pink"] as const;
export type Color = (typeof COLORS)[number];

export interface NoteMeta {
  id: string;
  color: Color;
  w: number;
  h: number;
  alwaysOnTop: boolean;
  open: boolean;
  hidden: boolean;
  created: number;
  modified: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  color: Color;
  modified: number;
  open: boolean;
  hidden: boolean;
  deletedAt: number | null;
}

export const api = {
  loadNote: (id: string) => invoke<{ meta: NoteMeta; content: string }>("load_note", { id }),
  saveNote: (id: string, content: string) => invoke<void>("save_note", { id, content }),
  newNote: (content?: string) => invoke<string>("new_note", { content }),
  openNote: (id: string) => invoke<void>("open_note", { id }),
  restoreNote: (id: string) => invoke<void>("restore_note", { id }),
  closeNote: (id: string) => invoke<void>("close_note", { id }),
  trashNote: (id: string) => invoke<void>("trash_note", { id }),
  toggleOnTop: (id: string) => invoke<boolean>("toggle_on_top", { id }),
  setColor: (id: string, color: Color) => invoke<void>("set_color", { id, color }),
  listNotes: () => invoke<NoteSummary[]>("list_notes"),
  listTrash: () => invoke<NoteSummary[]>("list_trash"),
  showManager: () => invoke<void>("show_manager"),
};
