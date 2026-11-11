import { EditorState, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { editorInfoField, editorLivePreviewField, MarkdownView, type App, type TFile } from 'obsidian';
import { locateFragment } from '../formatting/fragment';
import { MAX_LINES, MAX_SOURCE, type LineSegment } from '../formatting/types';
import type { PreferencesStore } from '../settings/store';

export const revisionField = StateField.define<number>({ create: () => 0, update: (value, transaction) => value + Number(transaction.docChanged) });

/** Bounded wall-clock budgets for making parser context available on long selections. */
const SELECTION_SYNTAX_ENSURE_MS = 50;
const LINE_SYNTAX_ENSURE_MS = 10;

export interface SelectionSnapshot {
  readonly file: TFile;
  readonly path: string;
  readonly revision: number;
  readonly anchor: number;
  readonly head: number;
  readonly selectionLength: number;
  readonly lines: readonly LineSegment[];
}

export type SelectionRejection =
  | { readonly kind: 'preferences'; readonly status: 'loadError' | 'schemaError' | 'conflict' }
  | { readonly kind: 'noEditor' | 'readOnly' | 'composing' | 'multipleSelections' | 'emptySelection' | 'tooManyLines' | 'multiLineStructure' | 'multiLineUnsafe' | 'syntaxPending' | 'protectedSyntax' | 'unsupportedFragment' }
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

/** Length of quote/list/task/heading structure before the editable text of a line. */
export function structuralPrefix(text: string): number {
  let prefix = /^(?: {0,3}>[ \t]*)*/.exec(text)![0].length;
  const list = /^(?:[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/.exec(text.slice(prefix));
  prefix += list?.[0].length ?? 0;
  prefix += /^#{1,6}[ \t]+/.exec(text.slice(prefix))?.[0].length ?? 0;
  return prefix;
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
  const selectionLength = selection.to - selection.from;
  if (selectionLength > MAX_SOURCE) return blocked({ kind: 'tooLong', stage: 'selection' });
  if (!view.state.doc.sliceString(selection.from, selection.to).trim()) return blocked({ kind: 'emptySelection' });

  const state = view.state;
  const startLine = state.doc.lineAt(selection.from);
  let endLine = state.doc.lineAt(selection.to);
  if (selection.to === endLine.from && endLine.number > startLine.number) endLine = state.doc.line(endLine.number - 1);
  if (endLine.number - startLine.number + 1 > MAX_LINES) return blocked({ kind: 'tooManyLines' });

  const lines: LineSegment[] = [];
  if (startLine.number === endLine.number) {
    if (startLine.length > MAX_SOURCE) return blocked({ kind: 'tooLong', stage: 'line' });
    const syntax = inspectSyntax(state, selection.from, selection.to);
    if (syntax !== 'clear') return blocked({ kind: syntax === 'pending' ? 'syntaxPending' : 'protectedSyntax' });
    const prefix = structuralPrefix(startLine.text);
    if (selection.from < startLine.from + prefix) return blocked({ kind: 'protectedSyntax' });
    const base = startLine.from + prefix;
    const source = startLine.text.slice(prefix);
    const from = Math.max(selection.from - base, 0);
    const to = Math.min(selection.to, startLine.to) - base;
    const located = locateFragment(source, from, to);
    if (!located) return blocked({ kind: 'unsupportedFragment' });
    lines.push({ lineFrom: startLine.from, base, source, lineLength: startLine.length, located });
  } else {
    if (!syntaxTreeAvailable(state, selection.to)) ensureSyntaxTree(state, selection.to, SELECTION_SYNTAX_ENSURE_MS);
    for (let number = startLine.number; number <= endLine.number; number++) {
      const line = state.doc.line(number);
      const segFrom = number === startLine.number ? selection.from : line.from;
      const segTo = number === endLine.number ? Math.min(selection.to, line.to) : line.to;
      if (segFrom >= segTo) continue;
      if (!line.text.trim()) continue;
      if (line.length > MAX_SOURCE) return blocked({ kind: 'tooLong', stage: 'line' });
      if (structuralPrefix(line.text) > 0) return blocked({ kind: 'multiLineStructure' });
      if (!syntaxTreeAvailable(state, segTo)) ensureSyntaxTree(state, segTo, LINE_SYNTAX_ENSURE_MS);
      const syntax = inspectSyntax(state, segFrom, segTo);
      if (syntax !== 'clear') return blocked({ kind: syntax === 'pending' ? 'syntaxPending' : 'protectedSyntax' });
      const relFrom = segFrom - line.from;
      const relTo = segTo - line.from;
      const located = locateFragment(line.text, relFrom, relTo);
      if (!located || located.from !== relFrom || located.to !== relTo) return blocked({ kind: 'unsupportedFragment' });
      const fragment = located.fragment;
      if (fragment.code || fragment.foreground || fragment.background) return blocked({ kind: 'multiLineUnsafe' });
      lines.push({ lineFrom: line.from, base: line.from, source: line.text, lineLength: line.length, located });
    }
    if (!lines.length) return blocked({ kind: 'emptySelection' });
  }

  return { kind: 'ready', snapshot: { file: info.file, path: info.file.path, revision: state.field(revisionField), anchor: selection.anchor, head: selection.head, selectionLength, lines } };
}

export function matchesSnapshot(view: EditorView, snapshot: SelectionSnapshot): boolean {
  const info = view.state.field(editorInfoField, false);
  const selection = view.state.selection.main;
  return info?.file === snapshot.file && info.file.path === snapshot.path && view.state.field(revisionField) === snapshot.revision &&
    view.state.selection.ranges.length === 1 && selection.anchor === snapshot.anchor && selection.head === snapshot.head;
}

export function editableState(state: EditorState): boolean { return !state.readOnly && state.facet(EditorView.editable); }
