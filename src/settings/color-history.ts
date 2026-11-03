import { isCanonicalHex } from '../formatting/colors';
import type { ColorKind } from '../formatting/types';

export interface ColorHistory {
  readonly foreground: readonly string[];
  readonly background: readonly string[];
}

// Internal invariant: persistence input is decoded before it becomes a history snapshot.
export function copyHistory(value: ColorHistory): ColorHistory {
  for (const kind of ['foreground', 'background'] as const) {
    const colors = value[kind];
    if (!Array.isArray(colors) || colors.length > 5 || colors.some(color => !isCanonicalHex(color)) || new Set(colors).size !== colors.length) throw Error('Invalid color history');
  }
  return Object.freeze({ foreground: Object.freeze([...value.foreground]), background: Object.freeze([...value.background]) });
}

export const EMPTY_HISTORY = copyHistory({ foreground: [], background: [] });

export function sameHistory(left: ColorHistory, right: ColorHistory): boolean {
  return (['foreground', 'background'] as const).every(kind => left[kind].length === right[kind].length && left[kind].every((color, index) => color === right[kind][index]));
}

// Assert a programming contract: formatting validates canonical colors before committing.
// Invalid values must not be normalized or interpreted as removing a color here.
export function applyColorUse(history: ColorHistory, kind: ColorKind, color: string): ColorHistory {
  if ((kind !== 'foreground' && kind !== 'background') || !isCanonicalHex(color)) throw Error('Invalid color use');
  if (history[kind][0] === color) return history;
  return copyHistory({ ...history, [kind]: [color, ...history[kind].filter(value => value !== color)].slice(0, 5) });
}

export function replayColorUses(base: ColorHistory, uses: ColorHistory): ColorHistory {
  const merge = (kind: ColorKind) => [...new Set([...uses[kind], ...base[kind]])].slice(0, 5);
  return copyHistory({ foreground: merge('foreground'), background: merge('background') });
}
