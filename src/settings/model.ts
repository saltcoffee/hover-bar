import { copyLayout, type ToolbarLayout } from '../toolbar/layout';

export const BOOLEAN_KEYS = ['automatic', 'livePreview', 'sourceMode', 'keyboard'] as const;
export type BooleanPreferenceKey = typeof BOOLEAN_KEYS[number];
export interface Preferences {
  readonly automatic: boolean;
  readonly livePreview: boolean;
  readonly sourceMode: boolean;
  readonly keyboard: boolean;
  readonly toolbar: ToolbarLayout;
}
export const DEFAULTS: Preferences = Object.freeze({ automatic: true, livePreview: true, sourceMode: true, keyboard: false, toolbar: copyLayout({ kind: 'default' }) });

export function copyPreferences(value: Preferences): Preferences {
  if (BOOLEAN_KEYS.some(key => typeof value[key] !== 'boolean')) throw new Error('Invalid preferences');
  return Object.freeze({ automatic: value.automatic, livePreview: value.livePreview, sourceMode: value.sourceMode, keyboard: value.keyboard, toolbar: copyLayout(value.toolbar) });
}
