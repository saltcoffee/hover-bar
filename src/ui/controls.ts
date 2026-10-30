import { setIcon } from 'obsidian';
import type { Translate } from '../i18n';
import type { ActionView, ToolbarId } from './toolbar-types';

const ICONS: Readonly<Record<ToolbarId, string>> = {
  bold: 'bold', italic: 'italic', strike: 'strikethrough', code: 'code', highlight: 'highlighter',
  foreground: 'baseline', background: 'paint-bucket', link: 'link', chooseNote: 'chevron-down', clearColors: 'remove-formatting', more: 'ellipsis',
};

export function actionButton(document: Document, id: ToolbarId, t: Translate, menu = false): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button';
  button.className = `hover-bar-button${menu ? ' hover-bar-menu-item' : ''}`;
  button.dataset.action = id; button.setAttribute('aria-label', t(id));
  if (menu) button.textContent = t(id); else setIcon(button, ICONS[id]);
  return button;
}

export function setActionState(button: HTMLButtonElement, state: ActionView, label: string): void {
  button.setAttribute('aria-disabled', String(!state.enabled));
  button.setAttribute('aria-label', !state.enabled && state.reason ? `${label} · ${state.reason}` : label);
  if (state.pressed !== undefined) button.setAttribute('aria-pressed', String(state.pressed)); else button.removeAttribute('aria-pressed');
}

export function focusButton(button: HTMLElement | null | undefined): void { button?.focus({ preventScroll: true }); }
