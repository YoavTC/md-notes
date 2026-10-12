// Editor setup: CodeMirror 6 + Markdown (GFM) + live preview.

import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState, Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import {
  indentListItem,
  insertLink,
  outdentListItem,
  toggleMarker,
  toggleTaskOnLine,
} from "./commands";
import { livePreview } from "./livePreview";

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--link)" },
  { tag: t.url, color: "var(--link)" },
  { tag: t.monospace, fontFamily: "var(--mono)" },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: "var(--muted)" },
  { tag: t.quote, color: "var(--quote-fg)" },
  // Fenced code.
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "#7a3e9d" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#2f6f3e" },
  { tag: [t.comment, t.meta], color: "#8a8f98", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#a1520b" },
  { tag: [t.typeName, t.className, t.namespace], color: "#1d6f8a" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#2557a7" },
  { tag: [t.tagName, t.attributeName], color: "#2557a7" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--font-size)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--sans)", lineHeight: "1.5", overflowX: "hidden" },
  ".cm-content": { padding: "6px 0 24px", caretColor: "var(--fg)" },
  ".cm-line": { padding: "0 10px" },
  ".cm-placeholder": { color: "var(--muted)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
});

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (doc: string) => void;
  onOpenLink: (href: string) => void;
  extraKeys?: { key: string; run: () => boolean }[];
}

export function markdownExtensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(highlight),
    livePreview,
  ];
}

export function createEditor(opts: EditorOptions): EditorView {
  const linkClicks = EditorView.domEventHandlers({
    mousedown(e) {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-href]");
      const href = el?.dataset.href;
      if (!href) return false;
      e.preventDefault();
      opts.onOpenLink(href);
      return true;
    },
  });

  return new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        indentUnit.of("  "),
        placeholder("Write a note…"),
        keymap.of([
          ...(opts.extraKeys ?? []),
          { key: "Mod-b", run: toggleMarker("**") },
          { key: "Mod-i", run: toggleMarker("*") },
          { key: "Mod-Shift-x", run: toggleMarker("~~") },
          { key: "Mod-e", run: toggleMarker("`") },
          { key: "Mod-k", run: insertLink },
          { key: "Mod-Enter", run: toggleTaskOnLine },
          { key: "Tab", run: (v) => indentListItem(v) || indentMore(v) },
          { key: "Shift-Tab", run: (v) => outdentListItem(v) || indentLess(v) },
        ]),
        markdownExtensions(),
        keymap.of([...historyKeymap, ...defaultKeymap]),
        linkClicks,
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
}
