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

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim();
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) return null;
  return (hex.length === 4 ? '#' + [...hex.slice(1)].map(char => char + char).join('') : hex).toLowerCase();
}

export function isCanonicalHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
}

export function parseColorStyle(style: string): { foreground?: string; background?: string } | null {
  const match = /^(?:color:(#[0-9a-f]{6})(?:;background-color:(#[0-9a-f]{6}))?|background-color:(#[0-9a-f]{6}))$/.exec(style);
  if (!match) return null;
  return { foreground: match[1], background: match[2] ?? match[3] };
}
