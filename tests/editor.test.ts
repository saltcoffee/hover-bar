import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import type { MarkdownFileInfo, TFile } from 'obsidian';
import { editorInfoField } from './support/obsidian';
import { revisionField, type SelectionSnapshot } from '../src/editor/context';
import { applyEdit, checkPlanBudget } from '../src/editor/apply-edit';
import { locateFragment } from '../src/formatting/fragment';
import { planFormat } from '../src/formatting/multiline';
import { formatFragment } from '../src/formatting/markdown';

function editor(reverse = false, reject = false) {
  // Deliberately minimal host boundary. CodeMirror document, selection, filters and undo are real.
  const file = { path: 'test.md' } as TFile;
  let state = EditorState.create({ doc: 'before text after', selection: EditorSelection.single(reverse ? 11 : 7, reverse ? 7 : 11),
    extensions: [revisionField, history(), editorInfoField.init(() => ({ file }) as MarkdownFileInfo), ...(reject ? [EditorState.transactionFilter.of(() => [])] : [])] });
  const view = { get state() { return state; }, dispatch(spec: TransactionSpec) { state = state.update(spec).state; } } as unknown as EditorView;
  const snapshot = (): SelectionSnapshot => {
    const doc = state.doc, selection = state.selection.main;
    const from = Math.min(selection.from, selection.to), to = Math.max(selection.from, selection.to);
    return { file, path: file.path, revision: state.field(revisionField), anchor: selection.anchor, head: selection.head, selectionLength: to - from,
      lines: [{ lineFrom: 0, base: 0, source: doc.toString(), lineLength: doc.length, located: locateFragment(doc.toString(), from, to)! }] };
  };
  return { view, snapshot, file };
}

function multiEditor(reverse = false) {
  const file = { path: 'test.md' } as TFile;
  let state = EditorState.create({ doc: 'aa\nbb\ncc', selection: EditorSelection.single(reverse ? 8 : 0, reverse ? 0 : 8),
    extensions: [revisionField, history(), editorInfoField.init(() => ({ file }) as MarkdownFileInfo)] });
  const view = { get state() { return state; }, dispatch(spec: TransactionSpec) { state = state.update(spec).state; } } as unknown as EditorView;
  const snapshot = (): SelectionSnapshot => {
    const doc = state.doc, selection = state.selection.main;
    let end = doc.lineAt(selection.to);
    if (selection.to === end.from && end.number > doc.lineAt(selection.from).number) end = doc.line(end.number - 1);
    const start = doc.lineAt(selection.from);
    const lines = [];
    for (let number = start.number; number <= end.number; number++) {
      const line = doc.line(number);
      if (!line.text.trim()) continue;
      const segFrom = number === start.number ? selection.from : line.from;
      const segTo = number === end.number ? Math.min(selection.to, line.to) : line.to;
      lines.push({ lineFrom: line.from, base: line.from, source: line.text, lineLength: line.length, located: locateFragment(line.text, segFrom - line.from, segTo - line.from)! });
    }
    return { file, path: file.path, revision: state.field(revisionField), anchor: selection.anchor, head: selection.head, selectionLength: Math.abs(selection.to - selection.from), lines };
  };
  return { view, snapshot, file };
}

describe('editor commit boundary', () => {
  it.each([false, true])('makes one reversible transaction and preserves selection direction (reverse=%s)', reverse => {
    const { view, snapshot } = editor(reverse);
    const before = snapshot();
    const result = formatFragment(before.lines[0]!.located, before.lines[0]!.source, 'bold');
    if (result.kind !== 'edit') throw Error('Expected plan');
    expect(applyEdit(view, before, result.plan)).toBe(true);
    expect(view.state.doc.toString()).toBe('before **text** after');
    expect(view.state.selection.main.anchor > view.state.selection.main.head).toBe(reverse);
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe('before text after');
    expect(redo(view)).toBe(true); expect(view.state.doc.toString()).toBe('before **text** after');
  });
  it.each([false, true])('applies every multi-line change in one reversible transaction (reverse=%s)', reverse => {
    const { view, snapshot } = multiEditor(reverse);
    const before = snapshot();
    const result = planFormat(before.lines, 'bold');
    if (result.kind !== 'edit') throw Error('Expected multi-line plan');
    expect(result.plan.changes).toHaveLength(3);
    expect(applyEdit(view, before, result.plan)).toBe(true);
    expect(view.state.doc.toString()).toBe('**aa**\n**bb**\n**cc**');
    expect(view.state.selection.main.anchor > view.state.selection.main.head).toBe(reverse);
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe('aa\nbb\ncc');
    expect(redo(view)).toBe(true); expect(view.state.doc.toString()).toBe('**aa**\n**bb**\n**cc**');
  });
  it('refuses out-of-order or overlapping multi-line changes', () => {
    const { view, snapshot } = multiEditor();
    const before = snapshot();
    const result = planFormat(before.lines, 'bold');
    if (result.kind !== 'edit') throw Error('Expected multi-line plan');
    const first = result.plan.changes[0]!;
    const second = result.plan.changes[1]!;
    expect(applyEdit(view, before, { changes: [second, first], selection: result.plan.selection })).toBe(false);
    expect(applyEdit(view, before, { changes: [first, { ...first }], selection: result.plan.selection })).toBe(false);
    expect(view.state.doc.toString()).toBe('aa\nbb\ncc');
  });
  it('rejects a plan that references a missing line segment', () => {
    const { view, snapshot } = editor();
    const before = snapshot();
    const plan = { changes: [{ line: 5, from: 0, to: 1, expected: 'before text after', insert: 'x', contentFrom: 0, contentTo: 1 }], selection: { anchor: 0, head: 1 } };
    expect(checkPlanBudget(before, plan)).toEqual({ kind: 'unavailable', reason: 'invalidParameter' });
    expect(applyEdit(view, before, plan)).toBe(false);
  });
  it('refuses stale text, changed selection, renamed files and read-only state', () => {
    for (const reason of ['text', 'selection', 'rename', 'readonly']) {
      const { view, snapshot, file } = editor();
      const before = snapshot();
      const result = formatFragment(before.lines[0]!.located, before.lines[0]!.source, 'bold');
      if (result.kind !== 'edit') throw Error('Expected plan');
      if (reason === 'text') view.dispatch({ changes: { from: 0, insert: 'new ' } });
      if (reason === 'selection') view.dispatch({ selection: EditorSelection.single(7, 10) });
      if (reason === 'rename') file.path = 'renamed.md';
      if (reason === 'readonly') {
        const readonly = EditorState.create({ doc: before.lines[0]!.source, selection: { anchor: 7, head: 11 }, extensions: [revisionField, EditorState.readOnly.of(true), editorInfoField.init(() => ({ file }) as MarkdownFileInfo)] });
        Object.defineProperty(view, 'state', { get: () => readonly });
      }
      expect(applyEdit(view, before, result.plan), reason).toBe(false);
    }
  });
  it('honors transaction filters without reporting success or adding history', () => {
    const { view, snapshot } = editor(false, true);
    const before = snapshot(); const result = formatFragment(before.lines[0]!.located, before.lines[0]!.source, 'bold');
    if (result.kind !== 'edit') throw Error('Expected plan');
    expect(applyEdit(view, before, result.plan)).toBe(false);
    expect(view.state.doc.toString()).toBe(before.lines[0]!.source); expect(undo(view)).toBe(false);
  });
  it('isolates formatting from preceding typing', () => {
    const { view, snapshot } = editor();
    view.dispatch({ changes: { from: 11, insert: 'x' }, selection: { anchor: 7, head: 11 }, userEvent: 'input.type' });
    const before = snapshot(); const result = formatFragment(before.lines[0]!.located, before.lines[0]!.source, 'bold');
    if (result.kind !== 'edit') throw Error('Expected plan');
    expect(applyEdit(view, before, result.plan)).toBe(true);
    undo(view); expect(view.state.doc.toString()).toBe('before textx after');
    undo(view); expect(view.state.doc.toString()).toBe('before text after');
  });
});
