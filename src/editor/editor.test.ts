import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { indentListItem, insertLink, outdentListItem, toggleMarker, toggleTaskOnLine } from "./commands";
import { createEditor, markdownExtensions } from "./index";
import { buildDecorations, safeHref, toggleTaskAt } from "./livePreview";

/** State with `|` marking the cursor or `[...]` marking a selection. */
function stateOf(src: string) {
  let doc = src;
  let sel: EditorSelection;
  const open = doc.indexOf("[["), close = doc.indexOf("]]");
  if (open >= 0 && close > open) {
    doc = doc.slice(0, open) + doc.slice(open + 2, close) + doc.slice(close + 2);
    sel = EditorSelection.single(open, close - 2);
  } else {
    const at = doc.indexOf("|");
    doc = doc.replace("|", "");
    sel = EditorSelection.single(Math.max(at, 0));
  }
  const state = EditorState.create({ doc, selection: sel, extensions: markdownExtensions() });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function apply(cmd: (t: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean, src: string) {
  let state = stateOf(src);
  const handled = cmd({ state, dispatch: (tr) => (state = tr.state) });
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  const shown = from === to ? doc.slice(0, from) + "|" + doc.slice(from) : doc.slice(0, from) + "[[" + doc.slice(from, to) + "]]" + doc.slice(to);
  return { handled, out: shown };
}

/** Rendered text: the doc with replaced ranges removed and widgets shown as tokens. */
function rendered(src: string, focused = true) {
  const state = stateOf(src);
  const set = buildDecorations(state, [{ from: 0, to: state.doc.length }], focused);
  const doc = state.doc.toString();
  let out = "";
  let pos = 0;
  set.between(0, doc.length, (from, to, deco) => {
    if (!deco.spec.widget && !(deco.point && to > from)) return;
    if (from < pos) return;
    out += doc.slice(pos, from);
    const w = deco.spec.widget?.constructor.name;
    out += w === "CheckboxWidget" ? (deco.spec.widget.checked ? "☑" : "☐") : w === "BulletWidget" ? "•" : w === "RuleWidget" ? "───" : "";
    pos = to;
  });
  return out + doc.slice(pos);
}

describe("source fidelity", () => {
  it("never alters the document when loading", () => {
    const src = "# T\r\n\n_a_ __b__\n* x\n   + y\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1\n```\n<b>raw</b>\n";
    const parent = document.createElement("div");
    let changes = 0;
    const view = createEditor({ parent, doc: src, onChange: () => changes++, onOpenLink: () => {} });
    expect(view.state.doc.toString()).toBe(src.replace(/\r\n/g, "\n"));
    expect(changes).toBe(0);
    view.destroy();
  });

  it("CodeMirror line separator is preserved when the doc uses \\n", () => {
    const src = "a\nb\n";
    expect(stateOf(src).doc.toString()).toBe(src);
  });
});

describe("live preview", () => {
  it("hides marks on inactive lines and shows them on the cursor line", () => {
    expect(rendered("**bold** and *it*\n|")).toBe("bold and it\n");
    expect(rendered("**bold**|")).toBe("**bold**");
  });

  it("renders everything when the editor is unfocused", () => {
    expect(rendered("# Head|", false)).toBe("Head");
    expect(rendered("# Head|", true)).toBe("# Head");
  });

  it("renders headings, quotes, strikethrough and inline code", () => {
    expect(rendered("## Two\n> quoted\n~~gone~~ `code`\n|")).toBe("Two\nquoted\ngone code\n");
  });

  it("renders links as their text", () => {
    expect(rendered("see [docs](https://x.dev) now\n|")).toBe("see docs now\n");
  });

  it("renders bullets and task checkboxes", () => {
    expect(rendered("- a\n- [ ] b\n- [x] c\n|")).toBe("• a\n☐ b\n☑ c\n");
  });

  it("keeps the checkbox widget on the active line", () => {
    expect(rendered("- [ ] b|")).toBe("- ☐ b");
  });

  it("renders horizontal rules", () => {
    expect(rendered("a\n\n---\n\n|")).toBe("a\n\n───\n\n");
  });

  it("leaves ordered list numbers and partial syntax alone", () => {
    expect(rendered("1. one\n**unclosed\n|")).toBe("1. one\n**unclosed\n");
  });
});

describe("tasks", () => {
  it("toggles only the marker character", () => {
    const s = stateOf("- [ ] buy milk");
    const tr = toggleTaskAt(s, 2)!;
    expect(tr.state.doc.toString()).toBe("- [x] buy milk");
    expect(toggleTaskAt(tr.state, 2)!.state.doc.toString()).toBe("- [ ] buy milk");
    expect(toggleTaskAt(s, 0)).toBeNull();
  });

  it("Ctrl+Enter toggles the task on the cursor line", () => {
    expect(apply(toggleTaskOnLine, "- [ ] a|").out).toBe("- [x] a|");
    expect(apply(toggleTaskOnLine, "plain|").handled).toBe(false);
  });
});

describe("formatting commands", () => {
  it("wraps and unwraps bold", () => {
    expect(apply(toggleMarker("**"), "a [[word]] b").out).toBe("a **[[word]]** b");
    expect(apply(toggleMarker("**"), "a **[[word]]** b").out).toBe("a [[word]] b");
    expect(apply(toggleMarker("**"), "a [[**word**]] b").out).toBe("a [[word]] b");
  });

  it("does not confuse italic with bold", () => {
    expect(apply(toggleMarker("*"), "**[[w]]**").out).toBe("***[[w]]***");
    expect(apply(toggleMarker("*"), "***[[w]]***").out).toBe("**[[w]]**");
    expect(apply(toggleMarker("*"), "*[[w]]*").out).toBe("[[w]]");
  });

  it("inserts an empty pair at the cursor", () => {
    expect(apply(toggleMarker("**"), "a |").out).toBe("a **|**");
    expect(apply(toggleMarker("**"), "a **|**").out).toBe("a |");
  });

  it("Ctrl+K builds a link", () => {
    expect(apply(insertLink, "[[docs]]").out).toBe("[docs](|)");
    expect(apply(insertLink, "[[https://x.dev]]").out).toBe("[|](https://x.dev)");
    expect(apply(insertLink, "|").out).toBe("[|]()");
  });
});

describe("list indentation", () => {
  it("nests bullet items by the marker width", () => {
    expect(apply(indentListItem, "- a\n- b|").out).toBe("- a\n  - b|");
    expect(apply(indentListItem, "1. a\n2. b|").out).toBe("1. a\n   2. b|");
  });

  it("outdents to the parent level", () => {
    expect(apply(outdentListItem, "- a\n  - b|").out).toBe("- a\n- b|");
  });

  it("falls through outside lists", () => {
    expect(apply(indentListItem, "text|").handled).toBe(false);
  });
});

describe("links", () => {
  it("only opens safe schemes", () => {
    expect(safeHref("https://a.b")).toBe("https://a.b");
    expect(safeHref("www.a.b")).toBe("https://www.a.b");
    expect(safeHref("me@a.bc")).toBe("mailto:me@a.bc");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("file:///C:/x")).toBeNull();
  });
});

describe("paste", () => {
  it("inserts only the plain-text flavor of rich clipboard content", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    let doc = "";
    const view = createEditor({ parent, doc: "", onChange: (d) => (doc = d), onOpenLink: () => {} });
    const flavors: Record<string, string> = {
      "text/html": "<b>bold</b><script>alert(1)</script>",
      "text/plain": "bold",
    };
    const data = { types: Object.keys(flavors), getData: (t: string) => flavors[t] ?? "" };
    const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, "clipboardData", { value: data });
    view.contentDOM.dispatchEvent(ev);
    expect(doc).toBe("bold");
    view.destroy();
  });
});

describe("writing direction", () => {
  it("lets every line pick its own direction", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const doc = ["שלום עולם", "- [ ] משימה", "English line"].join("\n");
    const view = createEditor({ parent, doc, onChange: () => {}, onOpenLink: () => {} });
    const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.getAttribute("dir") === "auto")).toBe(true);
    expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true);
    view.destroy();
  });
});
