import { Annotation, EditorSelection, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { MAX_SOURCE, type EditPlan } from '../formatting/types';
import { editableState, matchesSnapshot, type SelectionSnapshot } from './context';

export const ownEdit = Annotation.define<boolean>();

export function checkPlanBudget(snapshot: SelectionSnapshot, plan: EditPlan):
  { readonly kind: 'available' } | { readonly kind: 'unavailable'; readonly reason: 'tooLong' | 'invalidParameter' } {
  if (snapshot.selectionLength > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong' };
  for (const change of plan.changes) {
    const segment = snapshot.lines[change.line];
    if (!segment) return { kind: 'unavailable', reason: 'invalidParameter' };
    if (change.insert.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong' };
    if (segment.source.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong' };
    if (segment.lineLength - (change.to - change.from) + change.insert.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong' };
  }
  return { kind: 'available' };
}

export function applyEdit(view: EditorView, snapshot: SelectionSnapshot, plan: EditPlan): boolean {
  const { state } = view;
  if (!editableState(state) || view.composing || !matchesSnapshot(view, snapshot)) return false;
  if (!plan.changes.length || checkPlanBudget(snapshot, plan).kind === 'unavailable') return false;

  let previousTo = -1;
  let totalDelta = 0;
  const absolute: { from: number; to: number; insert: string }[] = [];
  for (const change of plan.changes) {
    const segment = snapshot.lines[change.line];
    if (!segment) return false;
    if (change.from < 0 || change.to < change.from || change.to > segment.source.length) return false;
    const from = segment.base + change.from;
    const to = segment.base + change.to;
    if (from < previousTo || to > state.doc.length) return false;
    if (/[\r\n\0]/.test(change.insert) || change.insert === change.expected) return false;
    if (state.doc.sliceString(from, to) !== change.expected) return false;
    if (to > segment.lineFrom + segment.lineLength) return false;
    absolute.push({ from, to, insert: change.insert });
    previousTo = to;
    totalDelta += change.insert.length - (to - from);
  }

  const reverse = snapshot.anchor > snapshot.head;
  const anchor = reverse ? plan.selection.head : plan.selection.anchor;
  const head = reverse ? plan.selection.anchor : plan.selection.head;
  const low = Math.min(anchor, head);
  const high = Math.max(anchor, head);
  if (low < 0 || high > state.doc.length + totalDelta) return false;

  view.dispatch({
    changes: absolute,
    selection: EditorSelection.single(anchor, head),
    annotations: [ownEdit.of(true), isolateHistory.of('full'), Transaction.userEvent.of('input.hover-bar')],
  });

  let delta = 0;
  for (const change of plan.changes) {
    const segment = snapshot.lines[change.line]!;
    const from = segment.base + change.from + delta;
    if (view.state.doc.sliceString(from, from + change.insert.length) !== change.insert) return false;
    delta += change.insert.length - (change.to - change.from);
  }
  const actual = view.state.selection.main;
  const info = view.state.field(editorInfoField, false);
  return info?.file === snapshot.file && snapshot.file.path === snapshot.path &&
    view.state.selection.ranges.length === 1 && actual.anchor === anchor && actual.head === head;
}
