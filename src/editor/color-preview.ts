import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField, MarkdownView } from 'obsidian';
import { PALETTE } from '../formatting/colors';
import { parseFragment } from '../formatting/fragment';
import { MAX_SOURCE } from '../formatting/types';
import { inspectSyntax } from './context';
import type { Host } from './controller';

export function colorPreview(host: Host) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private preferences = host.store.value;
    private live = false;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate): void {
      const live = update.state.field(editorLivePreviewField, false) ?? false;
      if (update.docChanged || update.viewportChanged || this.preferences !== host.store.value || this.live !== live) {
        this.preferences = host.store.value; this.decorations = this.build(update.view);
      }
    }
    private build(view: EditorView): DecorationSet {
      this.live = view.state.field(editorLivePreviewField, false) ?? false;
      const info = view.state.field(editorInfoField, false);
      if (!this.live || !host.store.enabled || !host.store.value.livePreview || !info?.file) return Decoration.none;
      if (!host.app.workspace.getLeavesOfType('markdown').some(leaf => leaf.view instanceof MarkdownView && leaf.view.editor === info.editor)) return Decoration.none;
      const marks = [];
      const seen = new Set<number>();
      for (const range of view.visibleRanges) {
        let line = view.state.doc.lineAt(range.from);
        while (line.from <= range.to) {
          if (!seen.has(line.number) && line.length <= MAX_SOURCE) {
            seen.add(line.number);
            for (const match of line.text.matchAll(/<span style="[^"]+">[^<>]*<\/span>/g)) {
              const fragment = parseFragment(match[0]);
              const from = line.from + match.index;
              if (!fragment || inspectSyntax(view.state, from, from + match[0].length) !== 'clear') continue;
              const classes = [];
              for (const kind of ['foreground', 'background'] as const) {
                const color = PALETTE.find(color => color[kind] === fragment[kind]);
                if (color) classes.push(`hover-bar-text-${kind}-${color.id}`);
              }
              if (classes.length) marks.push(Decoration.mark({ class: classes.join(' ') }).range(from + fragment.contentFrom, from + fragment.contentTo));
            }
          }
          if (line.to === view.state.doc.length) break;
          line = view.state.doc.line(line.number + 1);
        }
      }
      return Decoration.set(marks, true);
    }
  }, { decorations: value => value.decorations });
}
