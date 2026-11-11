import { formatFragment } from '../formatting/markdown';
import { planFormat } from '../formatting/multiline';
import type { FormatAction, FormatResult, Mark } from '../formatting/types';
import { linkPlan, type LinkResult } from '../links/wikilink';
import { checkPlanBudget } from './apply-edit';
import type { SelectionSnapshot } from './context';

const MARKS: readonly Mark[] = ['bold', 'italic', 'strike', 'highlight'];
const isMark = (action: FormatAction): action is Mark => (MARKS as readonly string[]).includes(action);

export function formatSelection(snapshot: SelectionSnapshot, action: FormatAction, color?: string): FormatResult {
  if (snapshot.lines.length > 1 && !isMark(action)) return { kind: 'unavailable', reason: 'multiLineDisabled' };
  const segment = snapshot.lines[0]!;
  const result = isMark(action)
    ? planFormat(snapshot.lines, action)
    : formatFragment(segment.located, segment.source, action, color, segment.base, 0);
  if (result.kind === 'edit' && checkPlanBudget(snapshot, result.plan).kind === 'unavailable') return { kind: 'unavailable', reason: 'tooLong' };
  return result;
}

export function linkSelection(snapshot: SelectionSnapshot, target: string): LinkResult {
  if (snapshot.lines.length > 1) return { kind: 'unavailable', reason: 'multiLineDisabled' };
  const segment = snapshot.lines[0]!;
  const result = linkPlan(segment.located, segment.source, target, segment.base);
  if (result.kind === 'edit' && checkPlanBudget(snapshot, result.plan).kind === 'unavailable') return { kind: 'unavailable', reason: 'tooLong' };
  return result;
}
