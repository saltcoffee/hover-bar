import { DEFAULT_PINNED, isActionId, type ActionId, type ToolbarLayout } from '../toolbar/layout';
import { BOOLEAN_KEYS, DEFAULTS, copyPreferences, type Preferences } from './model';

export interface StoredSettingsV2 {
  readonly schemaVersion: 2;
  readonly automatic: boolean;
  readonly livePreview: boolean;
  readonly sourceMode: boolean;
  readonly keyboard: boolean;
  readonly toolbar: { readonly mode: 'default' | 'custom'; readonly pinned: readonly ActionId[] };
}
export class UnsupportedSchemaError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function decodeSettings(raw: unknown): { value: Preferences; migrated: boolean; recovered: boolean } {
  if (raw === null || raw === undefined) return { value: copyPreferences(DEFAULTS), migrated: false, recovered: false };
  if (!record(raw)) return { value: copyPreferences(DEFAULTS), migrated: false, recovered: true };
  const version = raw.schemaVersion;
  if (Object.hasOwn(raw, 'schemaVersion') && version !== 1 && version !== 2) throw new UnsupportedSchemaError('Unsupported preferences version');
  const migrated = version !== 2;
  let recovered = version === undefined;
  const flags = { automatic: true, livePreview: true, sourceMode: true, keyboard: false };
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') flags[key] = raw[key];
    else if (version === 2 || raw[key] !== undefined) recovered = true;
  }
  let toolbar: ToolbarLayout = { kind: 'default' };
  if (version === 2) {
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
  return { value: copyPreferences({ ...flags, toolbar }), migrated, recovered };
}

export function encodeSettings(value: Preferences): StoredSettingsV2 {
  const checked = copyPreferences(value);
  return {
    schemaVersion: 2, automatic: checked.automatic, livePreview: checked.livePreview, sourceMode: checked.sourceMode, keyboard: checked.keyboard,
    toolbar: { mode: checked.toolbar.kind, pinned: [...(checked.toolbar.kind === 'default' ? DEFAULT_PINNED : checked.toolbar.pinned)] },
  };
}
