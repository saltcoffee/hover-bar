import { Annotation, EditorSelection, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { MAX_SOURCE, type EditPlan } from '../formatting/types';
import { editableState, matchesSnapshot, type SelectionSnapshot } from './context';

export const ownEdit = Annotation.define<boolean>();

export function checkEditBudget(snapshot: Pick<SelectionSnapshot, 'lineLength'>, plan: EditPlan):
  { readonly kind: 'available' } | { readonly kind: 'unavailable'; readonly reason: 'tooLong'; readonly stage: 'fragmentOutput' | 'resultLine' } {
  if (plan.insert.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong', stage: 'fragmentOutput' };
  if (snapshot.lineLength - (plan.to - plan.from) + plan.insert.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong', stage: 'resultLine' };
  return { kind: 'available' };
}

export function applyEdit(view: EditorView, snapshot: SelectionSnapshot, plan: EditPlan): boolean {
  const { state } = view;
  const from = snapshot.base + plan.from;
  const to = snapshot.base + plan.to;
  if (!editableState(state) || view.composing || !matchesSnapshot(view, snapshot) ||
    plan.from < 0 || plan.to < plan.from || plan.to > snapshot.source.length || from < 0 || to > state.doc.length ||
    /[\r\n\0]/.test(plan.insert) || plan.insert === plan.expected || state.doc.sliceString(from, to) !== plan.expected) return false;
  const line = state.doc.lineAt(from);
  if (to > line.to || checkEditBudget({ lineLength: line.length }, plan).kind === 'unavailable') return false;
  const start = from + plan.contentFrom;
  const end = from + plan.contentTo;
  view.dispatch({
    changes: { from, to, insert: plan.insert },
    selection: EditorSelection.single(snapshot.anchor > snapshot.head ? end : start, snapshot.anchor > snapshot.head ? start : end),
    annotations: [ownEdit.of(true), isolateHistory.of('full'), Transaction.userEvent.of('input.hover-bar')],
  });
  const actual = view.state.selection.main;
  return view.state.field(editorInfoField, false)?.file === snapshot.file && snapshot.file.path === snapshot.path &&
    view.state.doc.sliceString(from, from + plan.insert.length) === plan.insert && view.state.selection.ranges.length === 1 &&
    actual.anchor === (snapshot.anchor > snapshot.head ? end : start) && actual.head === (snapshot.anchor > snapshot.head ? start : end);
}
