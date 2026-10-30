import type { ActionId } from '../toolbar/layout';
import type { PaletteKind } from './toolbar-types';

export type PanelOrigin =
  | { readonly kind: 'bar'; readonly actionId: ActionId }
  | { readonly kind: 'more'; readonly actionId: ActionId; readonly scrollTop: number };
export type PanelState =
  | { readonly kind: 'none' }
  | { readonly kind: 'more'; readonly scrollTop: number; readonly focusId?: ActionId }
  | { readonly kind: 'palette'; readonly palette: PaletteKind; readonly origin: PanelOrigin }
  | { readonly kind: 'notes'; readonly origin: PanelOrigin };

export function backState(state: PanelState): PanelState {
  if ((state.kind === 'palette' || state.kind === 'notes') && state.origin.kind === 'more') {
    return { kind: 'more', scrollTop: state.origin.scrollTop, focusId: state.origin.actionId };
  }
  return { kind: 'none' };
}

export function expandedPanel(state: PanelState, id: ActionId | 'more'): boolean {
  if (id === 'more') return state.kind === 'more' || ((state.kind === 'palette' || state.kind === 'notes') && state.origin.kind === 'more');
  return (state.kind === 'palette' && state.palette === id) || (state.kind === 'notes' && id === 'chooseNote');
}
