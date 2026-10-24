import { isPaletteColor } from './colors';
import { htmlText, markdownText } from './text';
import { MAX_SOURCE, type FormatAction, type Fragment, type FormatResult, type LocatedFragment, type Mark } from './types';

export function serialize(fragment: Fragment): { source: string; contentFrom: number; contentTo: number } {
  let prefix = fragment.leading;
  let suffix = fragment.trailing;
  const add = (open: string, close = open) => { prefix += open; suffix = close + suffix; };
  for (const [mark, token] of [['strike', '~~'], ['highlight', '=='], ['italic', '*'], ['bold', '**']] as const) {
    if (fragment.marks.includes(mark)) add(token);
  }
  let text: string;
  if (fragment.code) {
    const longest = Math.max(0, ...[...fragment.text.matchAll(/`+/g)].map(match => match[0].length));
    const token = '`'.repeat(longest + 1);
    const padded = fragment.text.startsWith('`') || fragment.text.endsWith('`') || (fragment.text.startsWith(' ') && fragment.text.endsWith(' '));
    add(token + (padded ? ' ' : ''), (padded ? ' ' : '') + token);
    text = fragment.text;
  } else if (fragment.foreground || fragment.background) {
    const style = [fragment.foreground && `color:${fragment.foreground}`, fragment.background && `background-color:${fragment.background}`].filter(Boolean).join(';');
    add(`<span style="${style}">`, '</span>');
    text = htmlText(fragment.text);
  } else text = markdownText(fragment.text);
  return { source: prefix + text + suffix, contentFrom: prefix.length, contentTo: prefix.length + text.length };
}

export function formatFragment(located: LocatedFragment, source: string, action: FormatAction, color?: string): FormatResult {
  if (!['bold', 'italic', 'strike', 'highlight', 'code', 'clearColors', 'foreground', 'background'].includes(action)) return { kind: 'unavailable' };
  const original = located.fragment;
  if (original.code && action !== 'code') return { kind: 'unavailable' };
  if (action === 'code' && (original.marks.length || original.foreground || original.background)) return { kind: 'unavailable' };
  let next: Fragment;
  if (action === 'foreground' || action === 'background') {
    if (!isPaletteColor(action, color)) return { kind: 'unavailable' };
    if (original[action] === color) return { kind: 'noop' };
    next = { ...original, [action]: color };
  } else if (action === 'clearColors') {
    if (!original.foreground && !original.background) return { kind: 'noop' };
    next = { ...original, foreground: undefined, background: undefined };
  } else if (action === 'code') {
    next = { ...original, code: !original.code, plainSource: original.code ? undefined : original.plainSource };
  } else {
    const marks: Mark[] = original.marks.includes(action) ? original.marks.filter(mark => mark !== action) : [...original.marks, action];
    next = { ...original, marks };
  }
  const serialized = serialize(next);
  if (serialized.source.length > MAX_SOURCE) return { kind: 'unavailable' };
  const expected = source.slice(located.from, located.to);
  if (serialized.source === expected) return { kind: 'noop' };
  return { kind: 'edit', plan: { from: located.from, to: located.to, expected, insert: serialized.source, contentFrom: serialized.contentFrom, contentTo: serialized.contentTo } };
}
