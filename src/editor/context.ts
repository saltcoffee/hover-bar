import { EditorState, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { editorInfoField, editorLivePreviewField, MarkdownView, type App, type TFile } from 'obsidian';
import { locateFragment } from '../formatting/fragment';
import { MAX_SOURCE, type LocatedFragment } from '../formatting/types';
import type { PreferencesStore } from '../settings/store';

export const revisionField = StateField.define<number>({ create: () => 0, update: (value, transaction) => value + Number(transaction.docChanged) });
export interface SelectionSnapshot {
  readonly file: TFile; readonly path: string; readonly revision: number;
  readonly anchor: number; readonly head: number; readonly base: number;
  readonly source: string; readonly located: LocatedFragment;
}

export function protectedSyntax(state: EditorState, from: number, to: number): boolean {
  if (!syntaxTreeAvailable(state, to)) return true;
  let protectedRange = false;
  syntaxTree(state).iterate({ from, to, enter(node) {
    if (/frontmatter|yaml|codeblock|fencedcode|indentedcode|table|math|comment|hashtag|wikilink|internal-link|embed|horizontalrule|headermark/i.test(node.name)) protectedRange = true;
  } });
  return protectedRange;
}

export function capture(view: EditorView, app: App, store: PreferencesStore): SelectionSnapshot | null {
  if (!store.enabled || view.composing || view.state.readOnly || !view.state.facet(EditorView.editable)) return null;
  const info = view.state.field(editorInfoField, false);
  if (!info?.file || !info.editor || view.state.selection.ranges.length !== 1) return null;
  const markdownView = app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
    .find(candidate => candidate instanceof MarkdownView && candidate.editor === info.editor);
  if (!(markdownView instanceof MarkdownView) || markdownView.getMode() !== 'source') return null;
  const live = view.state.field(editorLivePreviewField, false) ?? false;
  if (!(live ? store.value.livePreview : store.value.sourceMode)) return null;
  const selection = view.state.selection.main;
  if (selection.empty || selection.to - selection.from > MAX_SOURCE) return null;
  const line = view.state.doc.lineAt(selection.from);
  if (selection.to > line.to || line.length > MAX_SOURCE) return null;
  if (protectedSyntax(view.state, selection.from, selection.to)) return null;
  const sourceLine = line.text;
  let prefix = /^(?: {0,3}>[ \t]*)*/.exec(sourceLine)![0].length;
  const list = /^(?:[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/.exec(sourceLine.slice(prefix));
  prefix += list?.[0].length ?? 0;
  prefix += /^#{1,6}[ \t]+/.exec(sourceLine.slice(prefix))?.[0].length ?? 0;
  if (selection.from < line.from + prefix) return null;
  const source = sourceLine.slice(prefix);
  const base = line.from + prefix;
  const located = locateFragment(source, selection.from - base, selection.to - base);
  if (!located) return null;
  return { file: info.file, path: info.file.path, revision: view.state.field(revisionField), anchor: selection.anchor, head: selection.head, base, source, located };
}

export function sameSelection(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return a.file === b.file && a.path === b.path && a.revision === b.revision && a.anchor === b.anchor && a.head === b.head;
}

export function editableState(state: EditorState): boolean { return !state.readOnly && state.facet(EditorView.editable); }
