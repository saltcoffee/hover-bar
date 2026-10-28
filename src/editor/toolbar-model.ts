import type { Translate } from '../i18n';
import { PALETTE } from '../formatting/colors';
import type { FormatAction, FormatResult } from '../formatting/types';
import { linkTextRejection, type LinkResult } from '../links/wikilink';
import type { ActionView, ToolbarViewModel } from '../ui/toolbar-types';
import type { SelectionSnapshot } from './context';
import { actionFeedback } from './feedback';
import { formatSelection, linkSelection } from './selection-actions';

export function toolbarModel(snapshot: SelectionSnapshot, t: Translate): ToolbarViewModel {
  const fragment = snapshot.located.fragment;
  const state = (result: FormatResult | LinkResult): ActionView => result.kind === 'unavailable'
    ? { enabled: false, reason: t(actionFeedback(result.reason)) } : { enabled: true };
  const format = (action: FormatAction): ActionView => ({
    ...state(formatSelection(snapshot, action)),
    pressed: action === 'code' ? fragment.code : fragment.marks.some(mark => mark === action),
  });
  const palette = (kind: 'foreground' | 'background') => PALETTE.map(color => ({
    ...state(formatSelection(snapshot, kind, color[kind])), id: color.id, color: color[kind],
    label: `${t(color.id)} · ${color[kind]}`, pressed: fragment[kind] === color[kind],
  }));
  const palettes = { foreground: palette('foreground'), background: palette('background') };
  const resets = { foreground: state(formatSelection(snapshot, 'foreground')), background: state(formatSelection(snapshot, 'background')) };
  const paletteState = (kind: 'foreground' | 'background'): ActionView => ({
    enabled: resets[kind].enabled || palettes[kind].some(color => color.enabled),
    pressed: !!fragment[kind], reason: palettes[kind].find(color => !color.enabled)?.reason,
  });
  const linkReason = linkTextRejection(fragment);
  const chooseNote = linkReason ? { enabled: false, reason: t(actionFeedback(linkReason)) } : { enabled: true };
  return {
    controls: {
      bold: format('bold'), italic: format('italic'), strike: format('strike'), code: format('code'), highlight: format('highlight'),
      foreground: paletteState('foreground'), background: paletteState('background'), clearColors: state(formatSelection(snapshot, 'clearColors')),
      link: state(linkSelection(snapshot, fragment.text)), chooseNote, more: { enabled: true },
    }, palettes, resets,
  };
}
