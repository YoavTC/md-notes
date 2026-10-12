// Global settings: loading, applying to the current window, date formatting.

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  autostart: boolean;
  scale: number;
  animations: boolean;
  dateFormat: string;
  font: string;
  monoFont: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autostart: true,
  scale: 1,
  animations: true,
  dateFormat: "DD/MM/YYYY HH:mm:ss",
  font: "Segoe UI",
  monoFont: "Cascadia Mono",
};

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/**
 * Format a timestamp. Tokens: YYYY YY MMMM MMM MM M DD D HH H hh h mm ss A a.
 * Text in [brackets] is printed literally.
 */
export function formatDate(ms: number, format: string): string {
  const d = new Date(ms);
  const h = d.getHours();
  const h12 = h % 12 || 12;
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|ss|A|a/g, (tok, literal) => {
    if (literal !== undefined) return literal;
    switch (tok) {
      case "YYYY": return String(d.getFullYear());
      case "YY": return pad(d.getFullYear() % 100);
      case "MMMM": return d.toLocaleString([], { month: "long" });
      case "MMM": return d.toLocaleString([], { month: "short" });
      case "MM": return pad(d.getMonth() + 1);
      case "M": return String(d.getMonth() + 1);
      case "DD": return pad(d.getDate());
      case "D": return String(d.getDate());
      case "HH": return pad(h);
      case "H": return String(h);
      case "hh": return pad(h12);
      case "h": return String(h12);
      case "mm": return pad(d.getMinutes());
      case "ss": return pad(d.getSeconds());
      case "A": return h < 12 ? "AM" : "PM";
      case "a": return h < 12 ? "am" : "pm";
    }
    return tok;
  });
}

const cssFont = (name: string) => JSON.stringify(name);

/**
 * Apply settings to this window. Fonts are for note windows only; the notes
 * manager keeps the default UI font. (Scale is webview zoom, set by Rust on
 * note windows.)
 */
export function applySettings(s: Settings, { fonts = true } = {}) {
  const root = document.documentElement.style;
  if (fonts) {
    root.setProperty("--sans", `${cssFont(s.font)}, "Segoe UI", system-ui, sans-serif`);
    root.setProperty("--mono", `${cssFont(s.monoFont)}, "Cascadia Mono", Consolas, monospace`);
  }
  document.documentElement.classList.toggle("no-anim", !s.animations);
}

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<Settings>("set_settings", { settings });

/** Load settings, apply them, and keep applying changes. */
export async function initSettings(
  onChange?: (s: Settings) => void,
  options?: { fonts?: boolean },
): Promise<Settings> {
  const s = await getSettings();
  applySettings(s, options);
  await listen<Settings>("settings-changed", (e) => {
    applySettings(e.payload, options);
    onChange?.(e.payload);
  });
  return s;
}
