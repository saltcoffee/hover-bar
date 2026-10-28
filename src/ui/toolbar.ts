import { setIcon } from 'obsidian';
import type { Translate, TextKey } from '../i18n';
import { NotePicker } from './note-picker';
import type { ActionView, FormatId, PaletteKind, ToolbarActions, ToolbarId, ToolbarViewModel } from './toolbar-types';

const buttons: readonly [ToolbarId, string][] = [
  ['bold', 'bold'], ['italic', 'italic'], ['strike', 'strikethrough'], ['code', 'code'], ['highlight', 'highlighter'],
  ['foreground', 'baseline'], ['background', 'paint-bucket'], ['link', 'link'],
  ['chooseNote', 'chevron-down'], ['more', 'ellipsis'],
];
type PanelId = PaletteKind | 'more' | 'chooseNote';

export class Toolbar {
  readonly root: HTMLDivElement;
  readonly bar: HTMLDivElement;
  private panel: HTMLDivElement;
  private controls = new Map<ToolbarId, HTMLButtonElement>();
  private model: ToolbarViewModel | null = null;
  private openPanel: PanelId | null = null;
  private returnTo: HTMLButtonElement | null = null;
  private picker: NotePicker | null = null;
  private compact = false;

  constructor(private readonly document: Document, private readonly t: Translate, private readonly actions: ToolbarActions) {
    this.root = document.createElement('div');
    this.root.className = 'hover-bar-layer'; this.root.hidden = true;
    this.bar = document.createElement('div'); this.bar.className = 'hover-bar';
    this.bar.setAttribute('role', 'toolbar'); this.bar.setAttribute('aria-label', t('toolbar'));
    this.panel = document.createElement('div'); this.panel.className = 'hover-bar-panel'; this.panel.hidden = true;
    this.root.append(this.bar, this.panel);
    for (const [key, icon] of buttons) {
      const button = this.button(key, icon); button.dataset.action = key;
      if (['italic', 'code', 'highlight'].includes(key)) button.classList.add('hover-bar-secondary');
      if (key === 'foreground' || key === 'link') button.classList.add('hover-bar-group-start');
      button.addEventListener('click', () => this.activate(key, button));
      this.controls.set(key, button); this.bar.append(button);
    }
    this.root.addEventListener('pointerdown', event => {
      // Retain the editor selection without changing native search input behavior.
      if (event.button === 0 && event.composedPath().some(node =>
        (node as Element).tagName === 'BUTTON' || (node as Element).getAttribute?.('role') === 'option')) event.preventDefault();
    });
    this.root.addEventListener('keydown', event => this.onKey(event));
    this.root.addEventListener('contextmenu', event => {
      if (!event.composedPath().some(node => (node as Element).tagName === 'INPUT')) event.preventDefault();
    });
    document.body.append(this.root);
  }

  private button(key: TextKey, icon?: string): HTMLButtonElement {
    const button = this.document.createElement('button');
    button.type = 'button'; button.className = 'hover-bar-button'; button.setAttribute('aria-label', this.t(key));
    if (icon) setIcon(button, icon); else button.textContent = this.t(key);
    return button;
  }

  private state(button: HTMLButtonElement, state: ActionView, label: string): void {
    button.setAttribute('aria-disabled', String(!state.enabled));
    button.setAttribute('aria-label', !state.enabled && state.reason ? `${label} · ${state.reason}` : label);
    if (state.pressed !== undefined) button.setAttribute('aria-pressed', String(state.pressed));
  }

  private execute(state: ActionView, action: () => void): void {
    if (!state.enabled) this.actions.explain(state.reason ?? this.t('failed')); else action();
  }

  update(model: ToolbarViewModel): void {
    this.model = model;
    for (const [key, button] of this.controls) {
      this.state(button, model.controls[key], this.t(key));
      if (['foreground', 'background', 'chooseNote', 'more'].includes(key)) {
        button.setAttribute('aria-haspopup', key === 'chooseNote' ? 'dialog' : 'true');
        button.setAttribute('aria-expanded', String(this.openPanel === key));
      }
    }
    this.roving();
  }

  show(compact: boolean): void {
    this.compact = compact; this.root.classList.toggle('is-compact', compact);
    this.root.hidden = false; this.root.classList.add('is-measuring'); this.roving();
  }
  positioned(left: number, top: number): void {
    this.root.style.setProperty('--hover-bar-left', `${left}px`); this.root.style.setProperty('--hover-bar-top', `${top}px`);
    this.root.classList.remove('is-measuring');
  }
  focus(): void {
    const items = this.focusable(this.bar);
    (items.find(item => item.getAttribute('aria-disabled') !== 'true') ?? items[0])?.focus({ preventScroll: true });
  }
  contains(event: Event): boolean { return event.composedPath().includes(this.root); }
  ownsFocus(): boolean { return this.root.contains(this.document.activeElement); }
  get visible(): boolean { return !this.root.hidden; }
  hide(): void { this.closePanel(false); this.root.hidden = true; }
  destroy(): void { this.hide(); this.root.remove(); }

  private activate(key: ToolbarId, button: HTMLButtonElement): void {
    if (!this.model) return;
    this.execute(this.model.controls[key], () => {
      if (this.openPanel && !['foreground', 'background', 'more', 'chooseNote'].includes(key)) {
        this.closePanel(false); button.focus({ preventScroll: true });
      }
      if (key === 'foreground' || key === 'background') this.palette(key, button);
      else if (key === 'more') this.more(button);
      else if (key === 'chooseNote') this.notePicker(button);
      else if (key === 'link') this.actions.quickLink();
      else this.actions.format(key as FormatId);
    });
  }

  private startPanel(key: PanelId, button: HTMLButtonElement): boolean {
    if (this.openPanel === key) { this.closePanel(true); return false; }
    // Transfer focus before removing a search input, so focusout retains session ownership.
    if (this.ownsFocus()) button.focus({ preventScroll: true });
    this.closePanel(false); this.openPanel = key; this.returnTo = button;
    this.panel.hidden = false; this.panel.replaceChildren();
    this.panel.setAttribute('role', key === 'chooseNote' ? 'dialog' : 'group'); this.panel.setAttribute('aria-label', this.t(key));
    if (this.model) this.update(this.model);
    return true;
  }

  closePanel(restoreFocus: boolean): void {
    this.picker?.cancel(); this.picker = null;
    const returnTo = this.returnTo; this.openPanel = null; this.returnTo = null;
    this.panel.hidden = true; this.panel.replaceChildren();
    for (const button of this.controls.values()) button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    if (this.visible) this.actions.resize();
  }

  private palette(kind: PaletteKind, button: HTMLButtonElement): void {
    if (!this.model || !this.startPanel(kind, button)) return;
    const grid = this.document.createElement('div'); grid.className = 'hover-bar-palette';
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', this.t(kind));
    for (const color of this.model.palettes[kind]) {
      const swatch = this.button(kind); swatch.textContent = '';
      swatch.className = `hover-bar-swatch hover-bar-${kind}-${color.id}`; this.state(swatch, color, color.label);
      if (color.pressed) setIcon(swatch, 'check');
      swatch.addEventListener('click', () => this.execute(color, () => { this.actions.format(kind, color.color); this.closePanel(true); }));
      grid.append(swatch);
    }
    const resetKey = kind === 'foreground' ? 'resetForeground' : 'resetBackground';
    const reset = this.button(resetKey); reset.classList.add('hover-bar-menu-item');
    const resetState = this.model.resets[kind]; this.state(reset, resetState, this.t(resetKey));
    reset.addEventListener('click', () => this.execute(resetState, () => { this.actions.format(kind); this.closePanel(true); }));
    this.panel.append(grid, reset); this.actions.resize(); this.focusable(this.panel)[0]?.focus({ preventScroll: true });
  }

  private more(button: HTMLButtonElement): void {
    if (!this.model || !this.startPanel('more', button)) return;
    const keys: FormatId[] = this.compact ? ['italic', 'code', 'highlight', 'clearColors'] : ['clearColors'];
    for (const key of keys) {
      const item = this.button(key); item.classList.add('hover-bar-menu-item');
      const state = this.model.controls[key]; this.state(item, state, this.t(key));
      item.addEventListener('click', () => this.execute(state, () => { this.actions.format(key); this.closePanel(true); }));
      this.panel.append(item);
    }
    this.actions.resize(); this.focusable(this.panel)[0]?.focus({ preventScroll: true });
  }

  notePicker(button = this.controls.get('chooseNote')!): void {
    if (!this.startPanel('chooseNote', button)) return;
    this.picker = new NotePicker(this.document, this.panel, this.t, this.actions);
  }

  private focusable(container: HTMLElement): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden &&
      !(this.compact && button.classList.contains('hover-bar-secondary') && button.getAttribute('aria-pressed') !== 'true'));
  }
  private roving(): void {
    const items = this.focusable(this.bar);
    const selected = items.find(item => item === this.document.activeElement) ?? items.find(item => item.getAttribute('aria-disabled') !== 'true') ?? items[0];
    for (const button of this.controls.values()) button.tabIndex = button === selected ? 0 : -1;
  }
  private onKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.openPanel) this.closePanel(true); else this.actions.close();
      return;
    }
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const container = this.openPanel ? this.panel : this.bar;
    const items = this.focusable(container);
    const index = items.indexOf(this.document.activeElement as HTMLButtonElement);
    const vertical = container.querySelector('.hover-bar-palette') ? 4 : 1;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? vertical : event.key === 'ArrowUp' ? -vertical : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : step ? (index + step + items.length) % items.length : -1;
    if (next >= 0) {
      event.preventDefault();
      if (container === this.bar) for (const item of items) item.tabIndex = item === items[next] ? 0 : -1;
      items[next]?.focus();
    }
  }
}
