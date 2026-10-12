// Formatting commands. All of them edit the Markdown source directly.

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, StateCommand } from "@codemirror/state";
import { toggleTaskAt } from "./livePreview";

function run(state: EditorState, start: number, ch: string, dir: -1 | 1, max: number) {
  let n = 0;
  let pos = start;
  while (n < max) {
    const c = dir < 0 ? state.sliceDoc(pos - 1, pos) : state.sliceDoc(pos, pos + 1);
    if (c !== ch) break;
    n++;
    pos += dir;
  }
  return n;
}

/** Is the `marker` emphasis present around [from, to)? Handles `*` vs `**` vs `***`. */
function surrounded(state: EditorState, from: number, to: number, marker: string) {
  const ch = marker[0];
  if (ch === "*" || ch === "_") {
    const n = Math.min(run(state, from, ch, -1, 3), run(state, to, ch, 1, 3));
    return marker.length === 2 ? n >= 2 : n === 1 || n === 3;
  }
  return state.sliceDoc(from - marker.length, from) === marker && state.sliceDoc(to, to + marker.length) === marker;
}

/** Does the selected text itself start and end with `marker`? */
function wrapsSelf(text: string, marker: string) {
  if (text.length < marker.length * 2) return false;
  if (!text.startsWith(marker) || !text.endsWith(marker)) return false;
  if (marker === "*") {
    // `**bold**` is not italic; `***both***` is.
    const lead = /^\*+/.exec(text)![0].length;
    const trail = /\*+$/.exec(text)![0].length;
    return Math.min(lead, trail) === 1 || Math.min(lead, trail) === 3;
  }
  return true;
}

/** Toggle an inline marker (`**`, `*`, `~~`, `` ` ``) around each selection. */
export function toggleMarker(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const len = marker.length;
    const tr = state.changeByRange((range) => {
      const { from, to } = range;
      const text = state.sliceDoc(from, to);
      if (!range.empty && wrapsSelf(text, marker)) {
        return {
          changes: [
            { from, to: from + len },
            { from: to - len, to },
          ],
          range: EditorSelection.range(from, to - 2 * len),
        };
      }
      if (surrounded(state, from, to, marker)) {
        return {
          changes: [
            { from: from - len, to: from },
            { from: to, to: to + len },
          ],
          range: EditorSelection.range(from - len, to - len),
        };
      }
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + len, to + len),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** Ctrl+K: wrap the selection as a link and put the cursor where the user types next. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange(({ from, to }) => {
    const text = state.sliceDoc(from, to);
    if (/^(https?:\/\/|www\.)\S+$/.test(text)) {
      return {
        changes: { from, to, insert: `[](${text})` },
        range: EditorSelection.cursor(from + 1),
      };
    }
    return {
      changes: { from, to, insert: `[${text}]()` },
      range: EditorSelection.cursor(text ? from + text.length + 3 : from + 1),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/** Ctrl+Enter: toggle the task checkbox on each selected line. */
export const toggleTaskOnLine: StateCommand = ({ state, dispatch }) => {
  let handled = false;
  const changes: { from: number; to: number; insert: string }[] = [];
  const doneLines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) {
      if (doneLines.has(l)) continue;
      doneLines.add(l);
      const line = state.doc.line(l);
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/.exec(line.text);
      if (!m) continue;
      const tr = toggleTaskAt(state, line.from + m[1].length);
      if (tr) {
        handled = true;
        tr.changes.iterChanges((from, to, _f, _t, ins) => changes.push({ from, to, insert: ins.toString() }));
      }
    }
  }
  if (handled) dispatch(state.update({ changes, userEvent: "input.toggle-task" }));
  return handled;
};

/** The ListItem node containing the start of `line`, if any. */
function listItemAt(state: EditorState, linePos: number) {
  const line = state.doc.lineAt(linePos);
  const indent = /^\s*/.exec(line.text)![0].length;
  let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(
    line.from + indent,
    1,
  );
  while (node && node.name !== "ListItem") node = node.parent;
  return node && state.doc.lineAt(node.from).number === line.number ? node : null;
}

/** Width of a list item's marker plus following spaces: the indent its children need. */
function markerWidth(state: EditorState, item: NonNullable<ReturnType<typeof listItemAt>>) {
  const mark = item.getChild("ListMark");
  if (!mark) return 2;
  const after = /^ */.exec(state.sliceDoc(mark.to, mark.to + 4))![0].length;
  return mark.to - mark.from + Math.max(1, Math.min(after, 4));
}

/** Tab on list lines: nest the item under its previous sibling. */
export const indentListItem: StateCommand = ({ state, dispatch }) => {
  const changes: { from: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) {
      if (seen.has(l)) continue;
      seen.add(l);
      const line = state.doc.line(l);
      const item = listItemAt(state, line.from);
      if (!item) {
        if (r.empty) return false;
        continue;
      }
      changes.push({ from: line.from, insert: " ".repeat(markerWidth(state, item)) });
    }
  }
  if (!changes.length) return false;
  dispatch(state.update({ changes, userEvent: "input.indent" }));
  return true;
};

/** Shift+Tab on list lines: move the item out one level. */
export const outdentListItem: StateCommand = ({ state, dispatch }) => {
  const changes: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) {
      if (seen.has(l)) continue;
      seen.add(l);
      const line = state.doc.line(l);
      const item = listItemAt(state, line.from);
      if (!item) {
        if (r.empty) return false;
        continue;
      }
      const parentItem = item.parent?.parent;
      const leading = /^ */.exec(line.text)![0].length;
      const width = parentItem?.name === "ListItem" ? markerWidth(state, parentItem) : leading;
      const remove = Math.min(leading, width);
      if (remove > 0) changes.push({ from: line.from, to: line.from + remove });
    }
  }
  if (!changes.length) return false;
  dispatch(state.update({ changes, userEvent: "delete.dedent" }));
  return true;
};
