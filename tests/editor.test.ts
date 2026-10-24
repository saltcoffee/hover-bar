import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import type { MarkdownFileInfo, TFile } from 'obsidian';
import { editorInfoField } from './support/obsidian';
import { revisionField, type SelectionSnapshot } from '../src/editor/context';
import { applyEdit } from '../src/editor/apply-edit';
import { locateFragment } from '../src/formatting/fragment';
import { formatFragment } from '../src/formatting/markdown';

function editor(reverse = false, reject = false) {
  // Deliberately minimal host boundary. CodeMirror document, selection, filters and undo are real.
  const file = { path: 'test.md' } as TFile;
  let state = EditorState.create({ doc: 'before text after', selection: EditorSelection.single(reverse ? 11 : 7, reverse ? 7 : 11),
    extensions: [revisionField, history(), editorInfoField.init(() => ({ file }) as MarkdownFileInfo), ...(reject ? [EditorState.transactionFilter.of(() => [])] : [])] });
  const view = { get state() { return state; }, dispatch(spec: TransactionSpec) { state = state.update(spec).state; } } as unknown as EditorView;
  const snapshot = (): SelectionSnapshot => ({ file, path: file.path, revision: state.field(revisionField), anchor: state.selection.main.anchor,
    head: state.selection.main.head, base: 0, source: state.doc.toString(), located: locateFragment(state.doc.toString(), state.selection.main.from, state.selection.main.to)! });
  return { view, snapshot, file };
}

describe('editor commit boundary', () => {
  it.each([false, true])('makes one reversible transaction and preserves selection direction (reverse=%s)', reverse => {
    const { view, snapshot } = editor(reverse);
    const before = snapshot();
    const result = formatFragment(before.located, before.source, 'bold');
    if (result.kind !== 'edit') throw Error('Expected plan');
    expect(applyEdit(view, before, result.plan)).toBe(true);
    expect(view.state.doc.toString()).toBe('before **text** after');
    expect(view.state.selection.main.anchor > view.state.selection.main.head).toBe(reverse);
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe('before text after');
    expect(redo(view)).toBe(true); expect(view.state.doc.toString()).toBe('before **text** after');
  });
  it('refuses stale text, changed selection, renamed files and read-only state', () => {
    for (const reason of ['text', 'selection', 'rename', 'readonly']) {
      const { view, snapshot, file } = editor();
      const before = snapshot();
      const result = formatFragment(before.located, before.source, 'bold');
      if (result.kind !== 'edit') throw Error('Expected plan');
      if (reason === 'text') view.dispatch({ changes: { from: 0, insert: 'new ' } });
      if (reason === 'selection') view.dispatch({ selection: EditorSelection.single(7, 10) });
      if (reason === 'rename') file.path = 'renamed.md';
      if (reason === 'readonly') {
        const readonly = EditorState.create({ doc: before.source, selection: { anchor: 7, head: 11 }, extensions: [revisionField, EditorState.readOnly.of(true), editorInfoField.init(() => ({ file }) as MarkdownFileInfo)] });
        Object.defineProperty(view, 'state', { get: () => readonly });
      }
      expect(applyEdit(view, before, result.plan), reason).toBe(false);
    }
  });
  it('honors transaction filters without reporting success or adding history', () => {
    const { view, snapshot } = editor(false, true);
    const before = snapshot(); const result = formatFragment(before.located, before.source, 'bold');
    if (result.kind !== 'edit') throw Error('Expected plan');
    expect(applyEdit(view, before, result.plan)).toBe(false);
    expect(view.state.doc.toString()).toBe(before.source); expect(undo(view)).toBe(false);
  });
  it('isolates formatting from preceding typing', () => {
    const { view, snapshot } = editor();
    view.dispatch({ changes: { from: 11, insert: 'x' }, selection: { anchor: 7, head: 11 }, userEvent: 'input.type' });
    const before = snapshot(); const result = formatFragment(before.located, before.source, 'bold');
    if (result.kind !== 'edit') throw Error('Expected plan');
    expect(applyEdit(view, before, result.plan)).toBe(true);
    undo(view); expect(view.state.doc.toString()).toBe('before textx after');
    undo(view); expect(view.state.doc.toString()).toBe('before text after');
  });
});
