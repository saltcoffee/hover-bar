import type { ColorKind } from './types';

export const PALETTE = [
  { id: 'red', foreground: '#e05252', background: '#f8d7da' },
  { id: 'orange', foreground: '#c66b2b', background: '#ffe3c2' },
  { id: 'yellow', foreground: '#9a7b16', background: '#fff3a3' },
  { id: 'green', foreground: '#388e5a', background: '#d7edda' },
  { id: 'teal', foreground: '#2b8b8b', background: '#ccebea' },
  { id: 'blue', foreground: '#3e80cc', background: '#d6e7ff' },
  { id: 'purple', foreground: '#9461c9', background: '#e8dcf8' },
  { id: 'gray', foreground: '#7f848e', background: '#e3e5e8' },
] as const;

export function isPaletteColor(kind: ColorKind, value: unknown): value is string | undefined {
  return value === undefined || PALETTE.some(color => color[kind] === value);
}

export function parseColorStyle(style: string): { foreground?: string; background?: string } | null {
  const match = /^(?:color:(#[0-9a-f]{6})(?:;background-color:(#[0-9a-f]{6}))?|background-color:(#[0-9a-f]{6}))$/.exec(style);
  if (!match) return null;
  return { foreground: match[1], background: match[2] ?? match[3] };
}
