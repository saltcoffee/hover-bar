import { formatFragment } from '../formatting/markdown';
import type { FormatAction, FormatResult } from '../formatting/types';
import { linkPlan, type LinkResult } from '../links/wikilink';
import { checkEditBudget } from './apply-edit';
import type { SelectionSnapshot } from './context';

export function formatSelection(snapshot: SelectionSnapshot, action: FormatAction, color?: string): FormatResult {
  const result = formatFragment(snapshot.located, snapshot.source, action, color);
  if (result.kind === 'edit' && checkEditBudget(snapshot, result.plan).kind === 'unavailable') return { kind: 'unavailable', reason: 'tooLong' };
  return result;
}

export function linkSelection(snapshot: SelectionSnapshot, target: string): LinkResult {
  const result = linkPlan(snapshot.located, snapshot.source, target);
  if (result.kind === 'edit' && checkEditBudget(snapshot, result.plan).kind === 'unavailable') return { kind: 'unavailable', reason: 'tooLong' };
  return result;
}
