import { MAX_SOURCE, type EditPlan, type LocatedFragment } from '../formatting/types';

export function safeLinkText(value: string): boolean {
  return !!value.trim() && value === value.trim() && !/[[\]|#^\r\n\0<>\\]/.test(value);
}

export function linkPlan(located: LocatedFragment, source: string, target: string): EditPlan | null {
  const fragment = located.fragment;
  if (fragment.code || fragment.marks.length || fragment.foreground || fragment.background || !safeLinkText(target) || !safeLinkText(fragment.text)) return null;
  const alias = fragment.text === target ? '' : `|${fragment.text}`;
  const prefix = `${fragment.leading}[[${target}${alias ? '|' : ''}`;
  const insert = `${fragment.leading}[[${target}${alias}]]${fragment.trailing}`;
  if (insert.length > MAX_SOURCE) return null;
  const contentFrom = alias ? prefix.length : fragment.leading.length + 2;
  return { from: located.from, to: located.to, expected: source.slice(located.from, located.to), insert, contentFrom, contentTo: contentFrom + (alias ? fragment.text.length : target.length) };
}
