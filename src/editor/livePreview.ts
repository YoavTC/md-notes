// Obsidian-style live preview on top of the raw Markdown source.
//
// The document is always the exact Markdown text. This plugin only adds
// decorations: syntax marks (`**`, `#`, `[...](url)`, ...) are hidden except on
// lines touched by the selection, task markers become checkboxes, bullets
// become dots, and block constructs get line classes for styling.

import { syntaxTree } from "@codemirror/language";
import { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-box";
    box.checked = this.checked;
    box.tabIndex = -1;
    box.setAttribute("aria-label", this.checked ? "Mark not done" : "Mark done");
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-hr";
    return hr;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const checked = Decoration.replace({ widget: new CheckboxWidget(true) });
const unchecked = Decoration.replace({ widget: new CheckboxWidget(false) });
const inlineCode = Decoration.mark({ class: "cm-inline-code" });

const lineDeco = new Map<string, Decoration>();
function lineClass(cls: string) {
  let d = lineDeco.get(cls);
  if (!d) lineDeco.set(cls, (d = Decoration.line({ class: cls })));
  return d;
}

/** Normalize a link target to something safe to open, or null. */
export function safeHref(raw: string): string | null {
  let url = raw.trim().replace(/^<|>$/g, "");
  if (/^www\./i.test(url)) url = "https://" + url;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(url)) url = "mailto:" + url;
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function linkMark(href: string | null) {
  return Decoration.mark({
    class: "cm-link-text",
    attributes: href ? { "data-href": href, title: `${href}\nCtrl+click to open` } : {},
  });
}

/** Line numbers touched by any selection range (none when unfocused). */
export function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) lines.add(l);
  }
  return lines;
}

/**
 * Compute live-preview decorations for the given ranges. Pure function of the
 * state so it can be tested without a DOM view.
 */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  focused: boolean,
): DecorationSet {
  const doc = state.doc;
  const active = activeLines(state, focused);
  const out: Range<Decoration>[] = [];
  const seen = new Set<string>();

  const add = (key: string, r: Range<Decoration>) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  const isActive = (from: number, to: number) => {
    for (let l = lineOf(from), e = lineOf(to); l <= e; l++) if (active.has(l)) return true;
    return false;
  };
  const sameLine = (from: number, to: number) => lineOf(from) === lineOf(to);
  const hideRange = (from: number, to: number) => {
    if (from < to && sameLine(from, to)) add(`h${from}:${to}`, hide.range(from, to));
  };
  const lines = (node: SyntaxNode, cls: string) => {
    for (let l = lineOf(node.from), e = lineOf(node.to); l <= e; l++) {
      const line = doc.line(l);
      add(`l${line.from}${cls}`, lineClass(cls).range(line.from));
    }
  };
  const selectionTouches = (from: number, to: number) =>
    focused && state.selection.ranges.some((r) => r.from < to && r.to > from);

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node;
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name);
        if (heading) {
          lines(node, `cm-h cm-h${heading[1]}`);
          return;
        }
        switch (name) {
          case "HeaderMark": {
            if (!node.parent?.name.startsWith("ATX") || isActive(node.from, node.to)) return;
            const leading = node.from === node.parent.from;
            if (leading) {
              const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
              hideRange(node.from, end);
            } else {
              let start = node.from;
              while (start > node.parent.from && doc.sliceString(start - 1, start) === " ") start--;
              hideRange(start, node.to);
            }
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
            if (!isActive(node.from, node.to)) hideRange(node.from, node.to);
            return;
          case "InlineCode": {
            const marks = node.getChildren("CodeMark");
            if (marks.length === 2) {
              if (marks[0].to < marks[1].from)
                add(`c${node.from}`, inlineCode.range(marks[0].to, marks[1].from));
              if (!isActive(node.from, node.to)) {
                hideRange(marks[0].from, marks[0].to);
                hideRange(marks[1].from, marks[1].to);
              }
            }
            return false;
          }
          case "Link": {
            const marks = node.getChildren("LinkMark");
            const url = node.getChild("URL");
            const href = url ? safeHref(doc.sliceString(url.from, url.to)) : null;
            if (marks.length >= 2 && marks[0].to < marks[1].from) {
              add(`a${node.from}`, linkMark(href).range(marks[0].to, marks[1].from));
              if (!isActive(node.from, node.to)) {
                hideRange(marks[0].from, marks[0].to);
                hideRange(marks[1].from, node.to);
              }
            }
            return false;
          }
          case "URL": {
            // Bare URLs and <autolinks>; URLs inside [text](url) are handled by Link.
            const href = safeHref(doc.sliceString(node.from, node.to));
            if (href && node.from < node.to) add(`u${node.from}`, linkMark(href).range(node.from, node.to));
            return;
          }
          case "Blockquote":
            lines(node, "cm-quote");
            return;
          case "QuoteMark":
            if (!isActive(node.from, node.to)) {
              const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
              hideRange(node.from, end);
            }
            return;
          case "HorizontalRule":
            if (!isActive(node.from, node.to) && sameLine(node.from, node.to))
              add(`r${node.from}`, rule.range(node.from, node.to));
            return;
          case "ListMark": {
            const item = node.parent;
            if (item?.parent?.name !== "BulletList") return;
            const isTask = item.getChild("Task") !== null;
            if (isActive(node.from, node.to)) return;
            if (isTask) {
              const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
              hideRange(node.from, end);
            } else {
              add(`b${node.from}`, bullet.range(node.from, node.to));
            }
            return;
          }
          case "TaskMarker": {
            const text = doc.sliceString(node.from, node.to);
            const done = /^\[[xX]\]$/.test(text);
            if (done) {
              const line = doc.lineAt(node.from);
              add(`l${line.from}done`, lineClass("cm-task-done").range(line.from));
            }
            if (!selectionTouches(node.from, node.to))
              add(`t${node.from}`, (done ? checked : unchecked).range(node.from, node.to));
            return;
          }
          case "FencedCode":
          case "CodeBlock": {
            lines(node, "cm-code-block");
            if (name === "FencedCode") {
              const first = doc.lineAt(node.from);
              add(`l${first.from}fence`, lineClass("cm-code-fence").range(first.from));
              const last = doc.lineAt(node.to);
              if (last.number !== first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text))
                add(`l${last.from}fence`, lineClass("cm-code-fence").range(last.from));
            }
            return false;
          }
          case "Table":
            lines(node, "cm-table");
            return;
        }
      },
    });
  }
  return Decoration.set(out, true);
}

/** Toggle the task marker `[ ]`/`[x]` starting at `pos`. */
export function toggleTaskAt(state: EditorState, pos: number) {
  const text = state.sliceDoc(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(text)) return null;
  return state.update({
    changes: { from: pos + 1, to: pos + 2, insert: text[1] === " " ? "x" : " " },
    userEvent: "input.toggle-task",
  });
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state, view.visibleRanges, view.hasFocus);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildDecorations(u.state, u.view.visibleRanges, u.view.hasFocus);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const target = e.target as HTMLElement;
        if (target instanceof HTMLInputElement && target.classList.contains("cm-task-box")) {
          const tr = toggleTaskAt(view.state, view.posAtDOM(target));
          if (tr) view.dispatch(tr);
          e.preventDefault();
          return true;
        }
        return false;
      },
    },
  },
);
