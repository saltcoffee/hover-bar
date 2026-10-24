import { parser, Strikethrough, type MarkdownConfig } from '@lezer/markdown';
import { parseColorStyle } from './colors';
import { decodeText } from './text';
import { MAX_SOURCE, type Fragment, type LocatedFragment, type Mark } from './types';

const highlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' };
const highlight: MarkdownConfig = {
  defineNodes: ['Highlight', 'HighlightMark'],
  parseInline: [{ name: 'Highlight', parse(context, next, position) {
    if (next !== 61 || context.char(position + 1) !== 61) return -1;
    return context.addDelimiter(highlightDelimiter, position, position + 2, true, true);
  } }],
};
const markdown = parser.configure([Strikethrough, highlight]);
const markByNode: Readonly<Record<string, Mark>> = {
  Emphasis: 'italic', StrongEmphasis: 'bold', Strikethrough: 'strike', Highlight: 'highlight',
};

function plainLeaf(source: string): boolean {
  const root = markdown.parse(source).topNode;
  const paragraph = root.firstChild;
  if (!paragraph || paragraph.name !== 'Paragraph' || paragraph.nextSibling) return false;
  for (let node = paragraph.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'Escape' && node.name !== 'Entity') return false;
  }
  return true;
}

export function parseFragment(source: string): Fragment | null {
  if (!source.trim() || source.length > MAX_SOURCE || /[\r\n\0]/.test(source)) return null;
  const leading = /^\s*/.exec(source)![0];
  const trailing = /\s*$/.exec(source)![0];
  let inner = source.slice(leading.length, source.length - trailing.length);
  let offset = leading.length;
  const marks: Mark[] = [];
  for (let depth = 0; depth < 5; depth++) {
    const node = markdown.parse(inner).topNode.firstChild?.firstChild;
    const mark = node && markByNode[node.name];
    if (!node || !mark || node.from !== 0 || node.to !== inner.length || node.nextSibling) break;
    const open = node.firstChild, close = node.lastChild;
    if (!open || !close || open.from !== 0 || close.to !== inner.length || open.name !== close.name) return null;
    const token = inner.slice(open.from, open.to);
    if (inner.slice(close.from, close.to) !== token || marks.includes(mark)) return null;
    marks.push(mark);
    inner = inner.slice(token.length, -token.length);
    offset += token.length;
    if (!inner.trim() || /^\s|\s$/.test(inner)) return null;
  }

  if (inner.startsWith('`')) {
    if (marks.length) return null;
    const paragraph = markdown.parse(inner).topNode.firstChild;
    const node = paragraph?.firstChild;
    if (node?.name !== 'InlineCode' || node.from !== 0 || node.to !== inner.length || node.nextSibling) return null;
    const token = /^`+/.exec(inner)![0];
    let text = inner.slice(token.length, -token.length);
    let padding = 0;
    if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) {
      text = text.slice(1, -1); padding = 1;
    }
    if (!text.trim()) return null;
    return { text, marks: [], code: true, leading, trailing, contentFrom: offset + token.length + padding, contentTo: offset + token.length + padding + text.length };
  }

  let colors: { foreground?: string; background?: string } = {};
  let colored = false;
  if (inner.startsWith('<span')) {
    const span = /^<span style="([^"]+)">([^<>]*)<\/span>$/.exec(inner);
    if (!span) return null;
    const parsed = parseColorStyle(span[1]!);
    if (!parsed) return null;
    colors = parsed; colored = true;
    const open = inner.indexOf('>') + 1;
    offset += open;
    inner = span[2]!;
    if (/[\\`*_~=[\]$%]/.test(inner)) return null;
  }
  if (!inner || (!colored && !plainLeaf(inner))) return null;
  // HTML payload is already a literal text node; backslash is not a Markdown escape here.
  const text = colored ? decodeHTMLPayload(inner) : decodeText(inner);
  if (!text.trim() || /[\r\n\0]/.test(text)) return null;
  return {
    text, plainSource: colored ? undefined : inner, marks, code: false,
    ...colors, leading, trailing, contentFrom: offset, contentTo: offset + inner.length,
  };
}

function decodeHTMLPayload(source: string): string {
  // Escape literal backslashes before using the common entity decoder, so they survive.
  return decodeText(source.replace(/\\/g, '\\\\'));
}

interface Span { from: number; to: number; protected: boolean }

export function locateFragment(line: string, from: number, to: number): LocatedFragment | null {
  if (line.length > MAX_SOURCE || from < 0 || to > line.length || from >= to) return null;
  for (const edge of [from, to]) {
    if (/[\uD800-\uDBFF]/.test(line[edge - 1] ?? '') && /[\uDC00-\uDFFF]/.test(line[edge] ?? '')) return null;
  }
  const spans: Span[] = [];
  const codeRanges: { from: number; to: number }[] = [];
  const tree = markdown.parse(line);
  tree.iterate({ enter(node) {
    if (['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Highlight', 'InlineCode', 'Link', 'Image', 'Autolink', 'HTMLTag', 'Entity', 'Escape'].includes(node.name)) {
      spans.push({ from: node.from, to: node.to, protected: ['Link', 'Image', 'Autolink'].includes(node.name) });
    }
    if (node.name === 'InlineCode') codeRanges.push({ from: node.from, to: node.to });
  } });
  for (const match of line.matchAll(/<span style="[^"]+">[^<>]*<\/span>/g)) spans.push({ from: match.index, to: match.index + match[0].length, protected: false });
  for (const expression of [/!?\[\[[^\]]*\]\]/g, /%%.*?%%/g, /(?:^|\s)#[\p{L}\p{N}_/-]+/gu, /\$[^$]+\$/g, /\b(?:[a-z][a-z\d+.-]*:\/\/|mailto:)[^\s]+/gi]) {
    for (const match of line.matchAll(expression)) {
      const end = match.index + match[0].length;
      if (codeRanges.some(range => range.from <= match.index && range.to >= end)) continue;
      const before = line.slice(0, match.index).match(/\\+$/)?.[0].length ?? 0;
      if (before % 2) continue;
      spans.push({ from: match.index, to: end, protected: true });
    }
  }
  let result: LocatedFragment | null = null;
  for (const span of [{ from, to, protected: false }, ...spans]) {
    if (span.protected || span.from > from || span.to < to) continue;
    const fragment = parseFragment(line.slice(span.from, span.to));
    if (!fragment) continue;
    const full = span.from === from && span.to === to;
    const content = span.from + fragment.contentFrom === from && span.from + fragment.contentTo === to;
    if ((full || content) && (!result || span.to - span.from > result.to - result.from)) {
      result = { from: span.from, to: span.to, fragment };
    }
  }
  if (!result) return null;
  const range = result;
  const adjacent = (line[range.from - 1] ?? '') + (line[range.to] ?? '');
  if (/[*_~`=\\<>[\]$%]/.test(adjacent)) return null;
  for (const span of spans) {
    const overlaps = span.from < range.to && span.to > range.from;
    if (overlaps && (span.protected || span.from < range.from || span.to > range.to)) return null;
  }
  return result;
}
