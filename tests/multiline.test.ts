import { describe, expect, it } from 'vitest';
import { locateFragment } from '../src/formatting/fragment';
import { planFormat } from '../src/formatting/multiline';
import { MAX_SOURCE, type LineSegment } from '../src/formatting/types';

function segments(text: string): LineSegment[] {
  let offset = 0;
  const lines: LineSegment[] = [];
  for (const line of text.split('\n')) {
    if (line.trim()) lines.push({ lineFrom: offset, base: offset, source: line, lineLength: line.length, located: locateFragment(line, 0, line.length)! });
    offset += line.length + 1;
  }
  return lines;
}

function render(text: string, action: 'bold' | 'italic' | 'strike' | 'highlight'): string {
  const lines = segments(text);
  const result = planFormat(lines, action);
  if (result.kind === 'noop') return text;
  if (result.kind !== 'edit') throw Error(`Unexpected ${result.reason}`);
  let next = text;
  for (const change of [...result.plan.changes].sort((a, b) => b.line - a.line)) {
    const from = lines[change.line]!.base + change.from;
    const to = lines[change.line]!.base + change.to;
    next = next.slice(0, from) + change.insert + next.slice(to);
  }
  return next;
}

describe('multi-line formatting plan', () => {
  it('adds and then removes the same mark across every line', () => {
    expect(render('甲\n乙', 'bold')).toBe('**甲**\n**乙**');
    expect(render('**甲**\n**乙**', 'bold')).toBe('甲\n乙');
  });
  it('keeps blank lines and only changes segments that lack the mark', () => {
    expect(render('甲\n\n乙', 'bold')).toBe('**甲**\n\n**乙**');
    const partial = planFormat(segments('**甲**\n乙\n**丙**'), 'bold');
    if (partial.kind !== 'edit') throw Error('Expected plan');
    expect(partial.plan.changes).toHaveLength(1);
    expect(render('**甲**\n乙\n**丙**', 'bold')).toBe('**甲**\n**乙**\n**丙**');
    expect(render('**甲**\n**乙**\n**丙**', 'bold')).toBe('甲\n乙\n丙');
  });
  it('maps the resulting selection over the formatted content', () => {
    const result = planFormat(segments('甲\n乙'), 'bold');
    if (result.kind !== 'edit') throw Error('Expected plan');
    expect(result.plan.selection).toEqual({ anchor: 0, head: 11 });
    const single = planFormat(segments('word'), 'bold');
    if (single.kind !== 'edit') throw Error('Expected single-line plan');
    expect(single.plan.selection).toEqual({ anchor: 2, head: 6 });
  });
  it('reports an empty plan as a no-op and over-budget fragments as too long', () => {
    expect(planFormat([], 'bold')).toEqual({ kind: 'noop' });
    const long = 'a'.repeat(MAX_SOURCE - 3);
    expect(planFormat(segments(long), 'bold')).toEqual({ kind: 'unavailable', reason: 'tooLong' });
  });
});
