import { applyMark, serialize } from './markdown';
import { MAX_SOURCE, type EditChange, type FormatResult, type LineSegment, type Mark, type PlanSelection } from './types';

function selectionFor(lines: readonly LineSegment[], changes: readonly EditChange[]): PlanSelection {
  const byLine = new Map<number, EditChange>();
  for (const change of changes) byLine.set(change.line, change);
  const single = lines.length === 1;
  const deltaBefore: number[] = [];
  let accumulated = 0;
  for (let i = 0; i < lines.length; i++) {
    deltaBefore[i] = accumulated;
    const change = byLine.get(i);
    if (change) accumulated += change.insert.length - (change.to - change.from);
  }
  const contentStart = (i: number): number => {
    const segment = lines[i]!;
    const change = byLine.get(i);
    const offset = change ? (single ? change.from + change.contentFrom : change.from) : segment.located.from;
    return segment.base + offset + deltaBefore[i]!;
  };
  const contentEnd = (i: number): number => {
    const segment = lines[i]!;
    const change = byLine.get(i);
    const offset = change ? (single ? change.from + change.contentTo : change.from + change.insert.length) : segment.located.to;
    return segment.base + offset + deltaBefore[i]!;
  };
  return { anchor: contentStart(0), head: contentEnd(lines.length - 1) };
}

/**
 * Multi-line coordination: decide add/remove across all non-empty segments and return one
 * ordered, non-overlapping multi-change plan with its selection mapping.
 */
export function planFormat(lines: readonly LineSegment[], action: Mark): FormatResult {
  if (!lines.length) return { kind: 'noop' };
  if (lines.some(line => line.located.fragment.code)) return { kind: 'unavailable', reason: 'codeOnly' };
  const allHave = lines.every(line => line.located.fragment.marks.includes(action));
  const mode = allHave ? 'remove' : 'add';
  const changes: EditChange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const segment = lines[i]!;
    const next = applyMark(segment.located.fragment, action, mode);
    if (!next) continue;
    const serialized = serialize(next);
    if (serialized.source.length > MAX_SOURCE) return { kind: 'unavailable', reason: 'tooLong' };
    const expected = segment.source.slice(segment.located.from, segment.located.to);
    if (serialized.source === expected) continue;
    changes.push({ line: i, from: segment.located.from, to: segment.located.to, expected, insert: serialized.source, contentFrom: serialized.contentFrom, contentTo: serialized.contentTo });
  }
  if (!changes.length) return { kind: 'noop' };
  return { kind: 'edit', plan: { changes, selection: selectionFor(lines, changes) } };
}
