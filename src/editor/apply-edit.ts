import { Annotation, EditorSelection, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { EditPlan } from '../formatting/types';
import { editableState, revisionField, type SelectionSnapshot } from './context';

export const ownEdit = Annotation.define<boolean>();

export function applyEdit(view: EditorView, snapshot: SelectionSnapshot, plan: EditPlan): boolean {
  const { state } = view;
  const info = state.field(editorInfoField, false);
  const selection = state.selection.main;
  const from = snapshot.base + plan.from;
  const to = snapshot.base + plan.to;
  if (!editableState(state) || info?.file !== snapshot.file || info.file.path !== snapshot.path ||
    state.field(revisionField) !== snapshot.revision || selection.anchor !== snapshot.anchor || selection.head !== snapshot.head ||
    state.doc.sliceString(from, to) !== plan.expected) return false;
  const start = from + plan.contentFrom;
  const end = from + plan.contentTo;
  view.dispatch({
    changes: { from, to, insert: plan.insert },
    selection: EditorSelection.single(snapshot.anchor > snapshot.head ? end : start, snapshot.anchor > snapshot.head ? start : end),
    annotations: [ownEdit.of(true), isolateHistory.of('full'), Transaction.userEvent.of('input.hover-bar')],
  });
  return view.state.doc.sliceString(from, from + plan.insert.length) === plan.insert;
}
