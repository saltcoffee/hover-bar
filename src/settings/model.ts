export interface Preferences {
  readonly schemaVersion: 1;
  readonly automatic: boolean;
  readonly livePreview: boolean;
  readonly sourceMode: boolean;
  readonly keyboard: boolean;
}
export type PreferenceKey = Exclude<keyof Preferences, 'schemaVersion'>;
export const DEFAULTS: Preferences = { schemaVersion: 1, automatic: true, livePreview: true, sourceMode: true, keyboard: false };

export function parsePreferences(value: unknown): { value: Preferences; recovered: boolean } {
  if (value === null || value === undefined) return { value: { ...DEFAULTS }, recovered: false };
  if (typeof value !== 'object' || Array.isArray(value)) return { value: { ...DEFAULTS }, recovered: true };
  const input = value as Record<string, unknown>;
  if (typeof input.schemaVersion === 'number' && input.schemaVersion > 1) throw new Error('schema');
  const result = { ...DEFAULTS };
  let recovered = input.schemaVersion !== 1;
  for (const key of ['automatic', 'livePreview', 'sourceMode', 'keyboard'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
    else if (input[key] !== undefined) recovered = true;
  }
  return { value: result, recovered };
}
