import { isCanonicalHex } from './colors';
import { htmlText, markdownText } from './text';
import { MAX_SOURCE, type EditChange, type FormatAction, type FormatResult, type Fragment, type LocatedFragment, type Mark, type PlanSelection } from './types';

export type MarkMode = 'add' | 'remove';

/** Apply or remove one basic mark; returns null when the fragment is already in that state. */
export function applyMark(fragment: Fragment, action: Mark, mode: MarkMode): Fragment | null {
  const has = fragment.marks.includes(action);
  if (mode === 'add' ? has : !has) return null;
  return { ...fragment, marks: mode === 'add' ? [...fragment.marks, action] : fragment.marks.filter(mark => mark !== action) };
}

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

function selectionFor(base: number, change: EditChange): PlanSelection {
  return { anchor: base + change.from + change.contentFrom, head: base + change.from + change.contentTo };
}

function planFor(located: LocatedFragment, source: string, next: Fragment, base: number, line: number): FormatResult {
  const serialized = serialize(next);
  if (serialized.source.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong' };
  const expected = source.slice(located.from, located.to);
  if (serialized.source === expected) return { kind: 'noop' };
  const change: EditChange = { line, from: located.from, to: located.to, expected, insert: serialized.source, contentFrom: serialized.contentFrom, contentTo: serialized.contentTo };
  return { kind: 'edit', plan: { changes: [change], selection: selectionFor(base, change) } };
}

/** Single-fragment path used by colors, inline code, and direct callers. Marks are unified through planFormat. */
export function formatFragment(located: LocatedFragment, source: string, action: FormatAction, color?: string, base = 0, line = 0): FormatResult {
  if (!['bold', 'italic', 'strike', 'highlight', 'code', 'clearColors', 'foreground', 'background'].includes(action)) return { kind: 'unavailable', reason: 'invalidParameter' };
  const original = located.fragment;
  if (original.code && action !== 'code') return { kind: 'unavailable', reason: 'codeOnly' };
  if (action === 'code' && (original.marks.length || original.foreground || original.background)) return { kind: 'unavailable', reason: 'plainOnly' };
  if (action === 'bold' || action === 'italic' || action === 'strike' || action === 'highlight') {
    const next = applyMark(original, action, original.marks.includes(action) ? 'remove' : 'add');
    if (!next) return { kind: 'noop' };
    return planFor(located, source, next, base, line);
  }
  if (action === 'foreground' || action === 'background') {
    if (color !== undefined && !isCanonicalHex(color)) return { kind: 'unavailable', reason: 'invalidParameter' };
    if (original[action] === color) return { kind: 'noop' };
    return planFor(located, source, { ...original, [action]: color }, base, line);
  }
  if (action === 'clearColors') {
    if (!original.foreground && !original.background) return { kind: 'noop' };
    return planFor(located, source, { ...original, foreground: undefined, background: undefined }, base, line);
  }
  return planFor(located, source, { ...original, code: !original.code, plainSource: original.code ? undefined : original.plainSource }, base, line);
}
