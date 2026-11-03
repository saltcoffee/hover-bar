import { DEFAULT_PINNED, isActionId, type ActionId, type ToolbarLayout } from '../toolbar/layout';
import { BOOLEAN_KEYS, DEFAULTS, copyPreferences, type Preferences } from './model';
import { normalizeHex } from '../formatting/colors';
import { copyHistory, EMPTY_HISTORY, type ColorHistory } from './color-history';

export interface StoredSettingsV3 {
  readonly schemaVersion: 3;
  readonly automatic: boolean;
  readonly livePreview: boolean;
  readonly sourceMode: boolean;
  readonly keyboard: boolean;
  readonly toolbar: { readonly mode: 'default' | 'custom'; readonly pinned: readonly ActionId[] };
  readonly colorHistory: ColorHistory;
}
export interface DecodedSettings { readonly value: Preferences; readonly history: ColorHistory; readonly migrated: boolean; readonly recovered: boolean; readonly historyRecovered: boolean }
export class UnsupportedSchemaError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function decodeSettings(raw: unknown): DecodedSettings {
  const empty = { value: copyPreferences(DEFAULTS), history: EMPTY_HISTORY, migrated: false, recovered: false, historyRecovered: false };
  if (raw === null || raw === undefined) return empty;
  if (!record(raw)) return { ...empty, recovered: true };
  const version = raw.schemaVersion;
  if (Object.hasOwn(raw, 'schemaVersion') && version !== 1 && version !== 2 && version !== 3) throw new UnsupportedSchemaError('Unsupported preferences version');
  const migrated = version !== 3;
  let recovered = version === undefined;
  const flags = { automatic: true, livePreview: true, sourceMode: true, keyboard: false };
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') flags[key] = raw[key];
    else if (version === 2 || version === 3 || raw[key] !== undefined) recovered = true;
  }
  let toolbar: ToolbarLayout = { kind: 'default' };
  if (version === 2 || version === 3) {
    const input = raw.toolbar;
    if (!record(input) || !Array.isArray(input.pinned) || (input.mode !== 'default' && input.mode !== 'custom')) recovered = true;
    else if (input.mode === 'default') {
      if (input.pinned.length !== DEFAULT_PINNED.length || input.pinned.some((id, index) => id !== DEFAULT_PINNED[index])) recovered = true;
    } else {
      const pinned: ActionId[] = [];
      for (const id of input.pinned as unknown[]) {
        if (!isActionId(id) || pinned.includes(id)) recovered = true;
        else pinned.push(id);
      }
      if (input.pinned.length > 0 && pinned.length === 0) recovered = true;
      else toolbar = { kind: 'custom', pinned };
    }
  }
  let historyRecovered = false;
  const history = { foreground: [] as string[], background: [] as string[] };
  if (version === 3) {
    const input = raw.colorHistory;
    for (const kind of ['foreground', 'background'] as const) {
      const list: unknown = record(input) ? input[kind] : undefined;
      if (!Array.isArray(list)) { historyRecovered = true; continue; }
      const normalized = list.map(normalizeHex);
      if (normalized.some(color => color === null)) { historyRecovered = true; continue; }
      history[kind] = [...new Set(normalized as string[])].slice(0, 5);
      if (list.length !== history[kind].length || list.some((color, index) => color !== history[kind][index])) historyRecovered = true;
    }
  }
  return { value: copyPreferences({ ...flags, toolbar }), history: copyHistory(history), migrated, recovered, historyRecovered };
}

export function encodeSettings(value: Preferences, history: ColorHistory = EMPTY_HISTORY): StoredSettingsV3 {
  const checked = copyPreferences(value);
  const colors = copyHistory(history);
  return {
    schemaVersion: 3, automatic: checked.automatic, livePreview: checked.livePreview, sourceMode: checked.sourceMode, keyboard: checked.keyboard,
    toolbar: { mode: checked.toolbar.kind, pinned: [...(checked.toolbar.kind === 'default' ? DEFAULT_PINNED : checked.toolbar.pinned)] },
    colorHistory: { foreground: [...colors.foreground], background: [...colors.background] },
  };
}
