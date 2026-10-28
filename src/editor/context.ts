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
  readonly source: string; readonly lineLength: number; readonly located: LocatedFragment;
}

export type SelectionRejection =
  | { readonly kind: 'preferences'; readonly status: 'loadError' | 'schemaError' | 'conflict' }
  | { readonly kind: 'noEditor' | 'readOnly' | 'composing' | 'multipleSelections' | 'emptySelection' | 'multipleLines' | 'syntaxPending' | 'protectedSyntax' | 'unsupportedFragment' }
  | { readonly kind: 'modeDisabled'; readonly mode: 'livePreview' | 'source' }
  | { readonly kind: 'tooLong'; readonly stage: 'selection' | 'line' };
export type CaptureResult = { readonly kind: 'ready'; readonly snapshot: SelectionSnapshot } | { readonly kind: 'blocked'; readonly reason: SelectionRejection };

export function inspectSyntax(state: EditorState, from: number, to: number): 'clear' | 'pending' | 'protected' {
  if (!syntaxTreeAvailable(state, to)) return 'pending';
  let protectedRange = false;
  syntaxTree(state).iterate({ from, to, enter(node) {
    if (/frontmatter|yaml|codeblock|fencedcode|indentedcode|table|math|comment|hashtag|wikilink|internal-link|embed|horizontalrule|headermark/i.test(node.name)) protectedRange = true;
  } });
  return protectedRange ? 'protected' : 'clear';
}

export function capture(view: EditorView, app: App, store: PreferencesStore): CaptureResult {
  const blocked = (reason: SelectionRejection): CaptureResult => ({ kind: 'blocked', reason });
  if (!store.enabled) return blocked({ kind: 'preferences', status: store.status === 'schemaError' ? 'schemaError' : store.status === 'conflict' ? 'conflict' : 'loadError' });
  const info = view.state.field(editorInfoField, false);
  if (!info?.file || !info.editor) return blocked({ kind: 'noEditor' });
  const markdownView = app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
    .find(candidate => candidate instanceof MarkdownView && candidate.editor === info.editor);
  if (!(markdownView instanceof MarkdownView) || markdownView.getMode() !== 'source') return blocked({ kind: 'noEditor' });
  const live = view.state.field(editorLivePreviewField, false) ?? false;
  if (!(live ? store.value.livePreview : store.value.sourceMode)) return blocked({ kind: 'modeDisabled', mode: live ? 'livePreview' : 'source' });
  if (!editableState(view.state)) return blocked({ kind: 'readOnly' });
  if (view.composing) return blocked({ kind: 'composing' });
  if (view.state.selection.ranges.length !== 1) return blocked({ kind: 'multipleSelections' });
  const selection = view.state.selection.main;
  if (selection.empty) return blocked({ kind: 'emptySelection' });
  if (selection.to - selection.from > MAX_SOURCE) return blocked({ kind: 'tooLong', stage: 'selection' });
  const line = view.state.doc.lineAt(selection.from);
  if (selection.to > line.to) return blocked({ kind: 'multipleLines' });
  if (line.length > MAX_SOURCE) return blocked({ kind: 'tooLong', stage: 'line' });
  if (!view.state.doc.sliceString(selection.from, selection.to).trim()) return blocked({ kind: 'emptySelection' });
  const syntax = inspectSyntax(view.state, selection.from, selection.to);
  if (syntax !== 'clear') return blocked({ kind: syntax === 'pending' ? 'syntaxPending' : 'protectedSyntax' });
  const sourceLine = line.text;
  let prefix = /^(?: {0,3}>[ \t]*)*/.exec(sourceLine)![0].length;
  const list = /^(?:[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/.exec(sourceLine.slice(prefix));
  prefix += list?.[0].length ?? 0;
  prefix += /^#{1,6}[ \t]+/.exec(sourceLine.slice(prefix))?.[0].length ?? 0;
  if (selection.from < line.from + prefix) return blocked({ kind: 'protectedSyntax' });
  const source = sourceLine.slice(prefix);
  const base = line.from + prefix;
  const located = locateFragment(source, selection.from - base, selection.to - base);
  if (!located) return blocked({ kind: 'unsupportedFragment' });
  return { kind: 'ready', snapshot: { file: info.file, path: info.file.path, revision: view.state.field(revisionField), anchor: selection.anchor, head: selection.head, base, source, lineLength: line.length, located } };
}

export function matchesSnapshot(view: EditorView, snapshot: SelectionSnapshot): boolean {
  const info = view.state.field(editorInfoField, false);
  const selection = view.state.selection.main;
  return info?.file === snapshot.file && info.file.path === snapshot.path && view.state.field(revisionField) === snapshot.revision &&
    view.state.selection.ranges.length === 1 && selection.anchor === snapshot.anchor && selection.head === snapshot.head;
}

export function editableState(state: EditorState): boolean { return !state.readOnly && state.facet(EditorView.editable); }
