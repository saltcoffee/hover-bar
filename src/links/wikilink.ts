import { MAX_SOURCE, type EditChange, type EditPlan, type Fragment, type LocatedFragment } from '../formatting/types';

export type LinkUnavailableReason = 'codeOnly' | 'plainOnly' | 'invalidText' | 'invalidTarget' | 'tooLong' | 'multiLineDisabled';
export type LinkResult = { readonly kind: 'edit'; readonly plan: EditPlan } | { readonly kind: 'unavailable'; readonly reason: LinkUnavailableReason };

export function safeLinkText(value: string): boolean {
  return !!value.trim() && value === value.trim() && !/[[\]|#^\r\n\0<>\\]/.test(value);
}

export function linkTextRejection(fragment: Fragment): LinkUnavailableReason | null {
  if (fragment.code) return 'codeOnly';
  if (fragment.marks.length || fragment.foreground || fragment.background) return 'plainOnly';
  return safeLinkText(fragment.text) ? null : 'invalidText';
}

export function linkPlan(located: LocatedFragment, source: string, target: string, base = 0): LinkResult {
  const fragment = located.fragment;
  const reason = linkTextRejection(fragment);
  if (reason) return { kind: 'unavailable', reason };
  if (!safeLinkText(target)) return { kind: 'unavailable', reason: 'invalidTarget' };
  const alias = fragment.text === target ? '' : `|${fragment.text}`;
  const prefix = `${fragment.leading}[[${target}${alias ? '|' : ''}`;
  const insert = `${fragment.leading}[[${target}${alias}]]${fragment.trailing}`;
  if (insert.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong' };
  const contentFrom = alias ? prefix.length : fragment.leading.length + 2;
  const contentTo = contentFrom + (alias ? fragment.text.length : target.length);
  const change: EditChange = { line: 0, from: located.from, to: located.to, expected: source.slice(located.from, located.to), insert, contentFrom, contentTo };
  return { kind: 'edit', plan: { changes: [change], selection: { anchor: base + located.from + contentFrom, head: base + located.from + contentTo } } };
}
