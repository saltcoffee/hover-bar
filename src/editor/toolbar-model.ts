import type { Translate } from '../i18n';
import { PALETTE } from '../formatting/colors';
import { MAX_SOURCE, type FormatResult, type Mark } from '../formatting/types';
import { linkTextRejection, type LinkResult } from '../links/wikilink';
import type { ActionView, ToolbarViewModel } from '../ui/toolbar-types';
import type { SelectionSnapshot } from './context';
import { actionFeedback } from './feedback';
import { formatSelection, linkSelection } from './selection-actions';
import { BASIC_FORMAT_IDS, resolveLayout } from '../toolbar/layout';
import type { Preferences } from '../settings/model';
import { EMPTY_HISTORY, type ColorHistory } from '../settings/color-history';

export function toolbarModel(snapshot: SelectionSnapshot, preferences: Preferences, t: Translate, history: ColorHistory = EMPTY_HISTORY): ToolbarViewModel {
  const lines = snapshot.lines;
  const multi = lines.length > 1;
  const primary = lines[0]!.located.fragment;
  const state = (result: FormatResult | LinkResult): ActionView => result.kind === 'unavailable'
    ? { enabled: false, reason: t(actionFeedback(result.reason)) } : { enabled: true };
  const disabled: ActionView = { enabled: false, reason: t('multiLineDisabled') };
  const markTokens: Record<Mark, number> = { bold: 2, italic: 1, strike: 2, highlight: 2 };
  const markView = (action: Mark): ActionView => {
    const hits = lines.filter(line => line.located.fragment.marks.includes(action)).length;
    const mixed = hits > 0 && hits < lines.length;
    if (multi) {
      const tooLong = hits < lines.length && lines.some(line => !line.located.fragment.marks.includes(action) && line.lineLength + markTokens[action] > MAX_SOURCE);
      return { enabled: !tooLong, ...(tooLong ? { reason: t('tooLong') } : {}), pressed: !mixed && hits === lines.length, ...(mixed ? { mixed: true } : {}) };
    }
    return { ...state(formatSelection(snapshot, action)), pressed: hits === lines.length };
  };
  const palette = (kind: 'foreground' | 'background') => PALETTE.map(color => ({
    ...(multi ? disabled : state(formatSelection(snapshot, kind, color[kind]))), id: color.id, color: color[kind],
    label: `${t(kind)} · ${t(color.id)} · ${color[kind]}`, pressed: !multi && primary[kind] === color[kind],
  }));
  const palettes = { foreground: palette('foreground'), background: palette('background') };
  const recent = (kind: 'foreground' | 'background') => history[kind].map(color => ({
    ...(multi ? disabled : state(formatSelection(snapshot, kind, color))), id: color, color, label: `${t(kind)} · ${color}`, pressed: !multi && primary[kind] === color,
  }));
  const resets = { foreground: multi ? disabled : state(formatSelection(snapshot, 'foreground')), background: multi ? disabled : state(formatSelection(snapshot, 'background')) };
  const paletteState = (kind: 'foreground' | 'background'): ActionView => multi ? disabled : {
    enabled: resets[kind].enabled || palettes[kind].some(color => color.enabled),
    pressed: !!primary[kind], reason: palettes[kind].find(color => !color.enabled)?.reason,
  };
  const linkReason = multi ? null : linkTextRejection(primary);
  const chooseNote = multi ? disabled : linkReason ? { enabled: false, reason: t(actionFeedback(linkReason)) } : { enabled: true };
  const controls: ToolbarViewModel['controls'] = {
      bold: markView('bold'), italic: markView('italic'), strike: markView('strike'), code: multi ? disabled : { ...state(formatSelection(snapshot, 'code')), pressed: primary.code }, highlight: markView('highlight'),
      foreground: paletteState('foreground'), background: paletteState('background'), clearColors: multi ? disabled : state(formatSelection(snapshot, 'clearColors')),
      link: multi ? disabled : state(linkSelection(snapshot, primary.text)), chooseNote, more: { enabled: true },
  };
  return { controls, palettes, recent: { foreground: recent('foreground'), background: recent('background') },
    colors: multi ? { foreground: undefined, background: undefined } : { foreground: primary.foreground, background: primary.background }, resets,
    layout: resolveLayout(preferences.toolbar, BASIC_FORMAT_IDS.filter(id => controls[id].pressed)) };
}
