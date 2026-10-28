import { describe, expect, it } from 'vitest';
import { locateFragment, parseFragment } from '../src/formatting/fragment';
import { formatFragment } from '../src/formatting/markdown';
import { decodeText } from '../src/formatting/text';
import { parseColorStyle } from '../src/formatting/colors';
import type { FormatAction } from '../src/formatting/types';
import { linkPlan } from '../src/links/wikilink';

function apply(source: string, action: FormatAction, color?: string): string {
  const located = locateFragment(source, 0, source.length);
  expect(located, source).not.toBeNull();
  const result = formatFragment(located!, source, action, color);
  if (result.kind === 'noop') return source;
  expect(result.kind).toBe('edit');
  if (result.kind !== 'edit') throw new Error('No edit');
  return result.plan.insert;
}

describe('single-fragment formatting', () => {
  it.each([['bold', '**'], ['italic', '*'], ['strike', '~~'], ['highlight', '==']] as const)('toggles %s and preserves surrounding whitespace', (action, marker) => {
    const result = apply('  中文 😀  ', action);
    expect(result).toBe(`  ${marker}中文 😀${marker}  `);
    expect(apply(result, action)).toBe('  中文 😀  ');
  });
  it('recognizes complete visible content and expands only its own outer envelope', () => {
    const source = 'before **<span style="color:#e05252">中文</span>** after';
    const from = source.indexOf('中文');
    const result = locateFragment(source, from, from + 2)!;
    expect(source.slice(result.from, result.to)).toBe('**<span style="color:#e05252">中文</span>**');
    expect(result.fragment.marks).toEqual(['bold']);
  });
  it('rejects partial styling, links, math, mixed content and malformed HTML', () => {
    for (const [source, from, to] of [['**hello**', 2, 4], ['[[note]]', 2, 6], ['[label](target)', 1, 6], ['$math$', 1, 5]] as const) {
      expect(locateFragment(source, from, to), source).toBeNull();
    }
    for (const source of ['a **b**', '<span style="color:red">x</span>', '<span style="color:#e05252">**x**</span>', '**a\nb**', '   ']) expect(parseFragment(source), source).toBeNull();
  });
  it('does not merge with adjacent unmatched delimiters', () => {
    expect(locateFragment('*hello', 1, 6)).toBeNull();
  });
  it.each([String.raw`*literal\*`, String.raw`_literal\_`, String.raw`~~literal\~~`, String.raw`==literal\==`])('preserves escaped closing markers as literal text: %s', source => {
    const expected = decodeText(source);
    expect(parseFragment(source)?.marks).toEqual([]);
    expect(parseFragment(source)?.text).toBe(expected);
    for (const action of ['bold', 'italic', 'strike', 'highlight', 'code', 'foreground', 'background'] as const) {
      const result = apply(source, action, action === 'foreground' ? '#e05252' : action === 'background' ? '#fff3a3' : undefined);
      expect(parseFragment(result)?.text, action).toBe(expected);
      const cleared = apply(result, action === 'foreground' || action === 'background' ? 'clearColors' : action);
      expect(parseFragment(cleared)?.text, action).toBe(expected);
    }
  });
  it.each(['**literal\\**', '==first==tail==', '**first**tail**'])('rejects partial or mixed wrappers instead of stripping their edges: %s', source => {
    expect(parseFragment(source)).toBeNull();
    expect(locateFragment(source, 0, source.length)).toBeNull();
  });
  it.each(['bold', 'highlight'] as const)('recognizes an unescaped closing marker after an escaped backslash: %s', mark => {
    const token = mark === 'bold' ? '**' : '==';
    const source = token + String.raw`literal\\` + token;
    expect(parseFragment(source)?.marks).toEqual([mark]);
    expect(parseFragment(source)?.text).toBe('literal\\');
    expect(parseFragment(apply(source, mark))?.text).toBe('literal\\');
  });
  it('combines marks in a stable order', () => {
    const source = apply(apply(apply('word', 'bold'), 'italic'), 'highlight');
    expect(source).toBe('==***word***==');
    expect(apply(source, 'bold')).toBe('==*word*==');
  });
  it('updates and removes colors without nesting spans or changing other marks', () => {
    let source = apply('word', 'foreground', '#e05252');
    source = apply(source, 'background', '#fff3a3');
    expect(source).toBe('<span style="color:#e05252;background-color:#fff3a3">word</span>');
    expect(apply(source, 'foreground', '#3e80cc').match(/<span/g)).toHaveLength(1);
    source = apply(source, 'bold');
    expect(apply(source, 'clearColors')).toBe('**word**');
  });
  it('treats an unchanged color as a no-op before normalizing existing marks', () => {
    const source = '_<span style="color:#e05252">word</span>_';
    const located = locateFragment(source, 0, source.length)!;
    expect(formatFragment(located, source, 'foreground', '#e05252')).toEqual({ kind: 'noop' });
    expect(formatFragment(locateFragment('word', 0, 4)!, 'word', 'clearColors')).toEqual({ kind: 'noop' });
  });
  it.each(['Tom & Jerry', '&amp;', '&amp;amp;', '\\*literal\\*', '&lt;tag&gt;', '\\&amp;', 'a\\\\b'])('preserves text through colors: %s', source => {
    const colored = apply(source, 'foreground', '#e05252');
    const cleared = apply(colored, 'clearColors');
    expect(parseFragment(colored)?.text).toBe(decodeText(source));
    expect(decodeText(cleared)).toBe(decodeText(source));
  });
  it.each(['value', 'a`b', '`edge`', '&amp;', '\\*literal\\*', '  a b  '])('preserves text through inline code: %s', source => {
    const code = apply(source, 'code');
    const cleared = apply(code, 'code');
    expect(decodeText(cleared)).toBe(decodeText(source));
  });
  it('does not decode entities inside existing inline code', () => {
    expect(decodeText(apply('`&amp;`', 'code'))).toBe('&amp;');
  });
  it('treats link, math and comment syntax inside code as literal text', () => {
    for (const text of ['$math$', 'https://example.com', '%%literal%%', '[[literal]]']) {
      expect(decodeText(apply('`' + text + '`', 'code'))).toBe(text);
    }
    expect(locateFragment('https://example.com', 0, 19)).toBeNull();
    expect(locateFragment('😀', 0, 1)).toBeNull();
  });
  it('rejects arbitrary CSS and overlong output', () => {
    const located = locateFragment('word', 0, 4)!;
    expect(formatFragment(located, 'word', 'foreground', 'url(https://example.com)')).toEqual({ kind: 'unavailable', reason: 'invalidParameter' });
    const long = 'a'.repeat(10_000);
    expect(formatFragment(locateFragment(long, 0, long.length)!, long, 'bold')).toEqual({ kind: 'unavailable', reason: 'tooLong' });
  });
  it('requires the exact color attribute order and separators', () => {
    for (const style of ['color:#e05252background-color:#fff3a3', ';background-color:#fff3a3', 'color:#e05252;', 'background-color:#fff3a3;color:#e05252', 'color:#e05252;font-size:40px']) {
      expect(parseColorStyle(style), style).toBeNull();
    }
    expect(parseColorStyle('background-color:#fff3a3')).toEqual({ foreground: undefined, background: '#fff3a3' });
  });
});

describe('internal links', () => {
  it('preserves display text and surrounding whitespace', () => {
    const source = ' term ';
    expect(linkPlan(locateFragment(source, 0, source.length)!, source, 'folder/note')).toMatchObject({ kind: 'edit', plan: { insert: ' [[folder/note|term]] ' } });
  });
  it.each(['bad|alias', 'bad#heading', 'bad]target', 'bad\nline'])('rejects ambiguous link syntax: %s', target => {
    expect(linkPlan(locateFragment('term', 0, 4)!, 'term', target)).toEqual({ kind: 'unavailable', reason: 'invalidTarget' });
  });
  it('does not drop formatting to make a link', () => {
    expect(linkPlan(locateFragment('**term**', 0, 8)!, '**term**', 'target')).toEqual({ kind: 'unavailable', reason: 'plainOnly' });
  });
});
