import { setIcon } from 'obsidian';
import type { Translate, TextKey } from '../i18n';
import type { ColorKind, FormatAction, Fragment } from '../formatting/types';
import { PALETTE } from '../formatting/colors';
import type { Box } from './position';
import { enableTouchActions } from './touch';

export interface NoteChoice { readonly path: string; readonly name: string; readonly disabled?: boolean }
export interface ToolbarActions {
  available(action: FormatAction, color?: string): boolean;
  format(action: FormatAction, color?: string): void;
  quickLink(): void;
  notes(query: string, signal: AbortSignal): Promise<readonly NoteChoice[]>;
  selectNote(path: string): void;
  close(): void;
  resize(): void;
}

const buttons: readonly [TextKey, string][] = [
  ['bold', 'bold'], ['italic', 'italic'], ['strike', 'strikethrough'], ['code', 'code'], ['highlight', 'highlighter'],
  ['foreground', 'baseline'], ['background', 'paint-bucket'], ['link', 'link'],
  ['chooseNote', 'chevron-down'], ['more', 'ellipsis'],
];

export class Toolbar {
  readonly root: HTMLDivElement;
  readonly bar: HTMLDivElement;
  private panel: HTMLDivElement;
  private controls = new Map<TextKey, HTMLButtonElement>();
  private fragment: Fragment | null = null;
  private openPanel: TextKey | null = null;
  private queryAbort: AbortController | null = null;
  private returnTo: HTMLButtonElement | null = null;
  private queryId = 0;
  private compact = false;
  private touch = false;
  private constraints = '';
  private dismiss: HTMLButtonElement;

  constructor(private readonly document: Document, private readonly t: Translate, private readonly actions: ToolbarActions) {
    this.root = document.createElement('div');
    this.root.className = 'hover-bar-layer'; this.root.hidden = true;
    this.bar = document.createElement('div'); this.bar.className = 'hover-bar';
    this.bar.setAttribute('role', 'toolbar'); this.bar.setAttribute('aria-label', t('toolbar'));
    this.panel = document.createElement('div'); this.panel.className = 'hover-bar-panel'; this.panel.hidden = true;
    this.root.append(this.bar, this.panel);
    const strip = document.createElement('div'); strip.className = 'hover-bar-actions';
    this.bar.append(strip);
    for (const [key, icon] of buttons) {
      const button = this.button(key, icon);
      button.dataset.action = key;
      if (['italic', 'code', 'highlight'].includes(key)) button.classList.add('hover-bar-secondary');
      if (key === 'foreground' || key === 'link') button.classList.add('hover-bar-group-start');
      button.addEventListener('click', () => this.activate(key, button));
      this.controls.set(key, button); strip.append(button);
    }
    this.dismiss = this.button('close', 'x'); this.dismiss.hidden = true; this.dismiss.tabIndex = -1;
    this.dismiss.addEventListener('click', () => this.actions.close()); this.bar.append(this.dismiss);
    this.root.addEventListener('pointerdown', event => {
      // Keep focus inside the toolbar until a button or note option handles its click.
      if (event.button === 0 && event.composedPath().some(node =>
        (node as Element).tagName === 'BUTTON' || (node as Element).getAttribute?.('role') === 'option')) event.preventDefault();
    });
    this.root.addEventListener('keydown', event => this.onKey(event));
    this.root.addEventListener('contextmenu', event => {
      if (!event.composedPath().some(node => (node as Element).tagName === 'INPUT')) event.preventDefault();
    });
    enableTouchActions(this.root);
    document.body.append(this.root);
  }

  private button(key: TextKey, icon?: string): HTMLButtonElement {
    const button = this.document.createElement('button');
    button.type = 'button'; button.className = 'hover-bar-button';
    button.setAttribute('aria-label', this.t(key));
    if (icon) setIcon(button, icon); else button.textContent = this.t(key);
    return button;
  }

  update(fragment: Fragment): void {
    this.fragment = fragment;
    for (const [key, button] of this.controls) {
      const plain = !fragment.code && !fragment.marks.length && !fragment.foreground && !fragment.background;
      const requiresPlain = key === 'code' && !fragment.code || ['link', 'chooseNote'].includes(key);
      const unsupported = ['bold', 'italic', 'strike', 'code', 'highlight'].includes(key) && !this.actions.available(key as FormatAction);
      const reason = fragment.code && key !== 'code' ? 'codeOnly' : requiresPlain && !plain ? 'plainOnly' : unsupported ? 'tooLong' : null;
      button.setAttribute('aria-disabled', String(reason !== null));
      const label = this.t(key);
      button.setAttribute('aria-label', reason ? `${label} · ${this.t(reason)}` : label);
      const active = key === 'code' ? fragment.code : key === 'foreground' || key === 'background' ? !!fragment[key] : fragment.marks.some(mark => mark === key);
      if (['bold', 'italic', 'strike', 'code', 'highlight', 'foreground', 'background'].includes(key)) button.setAttribute('aria-pressed', String(active));
      if (['foreground', 'background', 'chooseNote', 'more'].includes(key)) {
        button.setAttribute('aria-haspopup', key === 'chooseNote' ? 'dialog' : 'true');
        button.setAttribute('aria-expanded', String(this.openPanel === key));
      }
    }
    this.roving();
  }

  show(compact: boolean, touch = false): void {
    this.touch = touch; this.compact = compact && !touch;
    this.root.classList.toggle('is-compact', this.compact); this.root.classList.toggle('is-touch', touch);
    this.dismiss.hidden = !touch;
    this.root.hidden = false; this.root.classList.add('is-measuring'); this.roving();
  }
  constrain(bounds: Box): boolean {
    const width = Math.max(0, bounds.right - bounds.left - 16);
    const height = Math.max(0, bounds.bottom - bounds.top - 16);
    const key = `${width}:${height}`;
    if (key === this.constraints) return false;
    this.constraints = key;
    this.root.style.setProperty('--hover-bar-available-width', `${width}px`);
    this.root.style.setProperty('--hover-bar-available-height', `${height}px`);
    return true;
  }
  positioned(left: number, top: number): void {
    this.root.style.setProperty('--hover-bar-left', `${left}px`);
    this.root.style.setProperty('--hover-bar-top', `${top}px`);
    this.root.classList.remove('is-measuring');
  }
  focus(): void { this.focusable(this.bar)[0]?.focus({ preventScroll: true }); }
  contains(event: Event): boolean { return event.composedPath().includes(this.root); }
  ownsFocus(): boolean { return this.root.contains(this.document.activeElement); }
  get visible(): boolean { return !this.root.hidden; }
  get expanded(): boolean { return this.openPanel !== null; }
  hide(): void { this.closePanel(false); this.root.hidden = true; }
  destroy(): void { this.hide(); this.root.remove(); }

  private activate(key: TextKey, button: HTMLButtonElement): void {
    if (button.getAttribute('aria-disabled') === 'true') return;
    if (this.openPanel && !['foreground', 'background', 'more', 'chooseNote'].includes(key)) {
      const focus = !this.touch || this.ownsFocus();
      this.closePanel(false); if (focus) button.focus({ preventScroll: true });
    }
    if (key === 'foreground' || key === 'background') this.palette(key, button);
    else if (key === 'more') this.more(button);
    else if (key === 'chooseNote') this.notePicker(button);
    else if (key === 'link') this.actions.quickLink();
    else this.actions.format(key as FormatAction);
  }

  private startPanel(key: TextKey, button: HTMLButtonElement): boolean {
    if (this.openPanel === key) { this.closePanel(true); return false; }
    // Move focus before removing the old search input so focusout never sees an unowned session.
    if (this.ownsFocus()) button.focus({ preventScroll: true });
    this.closePanel(false); this.openPanel = key; this.returnTo = button;
    this.panel.hidden = false; this.panel.replaceChildren();
    this.panel.setAttribute('role', key === 'chooseNote' ? 'dialog' : 'group');
    this.panel.setAttribute('aria-label', this.t(key));
    if (this.fragment) this.update(this.fragment);
    return true;
  }

  closePanel(restoreFocus: boolean): void {
    const focus = !this.touch || this.ownsFocus();
    this.queryAbort?.abort(); this.queryAbort = null; this.queryId++;
    const returnTo = this.returnTo;
    this.openPanel = null; this.returnTo = null;
    this.panel.hidden = true; this.panel.replaceChildren();
    for (const button of this.controls.values()) button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && focus) returnTo?.focus({ preventScroll: true });
    if (this.visible) this.actions.resize();
  }

  private palette(kind: ColorKind, button: HTMLButtonElement): void {
    if (!this.startPanel(kind, button)) return;
    const grid = this.document.createElement('div'); grid.className = 'hover-bar-palette';
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', this.t(kind));
    for (const color of PALETTE) {
      const swatch = this.button(color.id);
      swatch.className = `hover-bar-swatch hover-bar-${kind}-${color.id}`;
      const label = `${this.t(color.id)} · ${color[kind]}`;
      const selected = this.fragment?.[kind] === color[kind];
      const disabled = !this.actions.available(kind, color[kind]);
      swatch.setAttribute('aria-disabled', String(disabled));
      swatch.setAttribute('aria-label', disabled ? `${label} · ${this.t('tooLong')}` : label);
      swatch.setAttribute('aria-pressed', String(selected));
      if (selected) setIcon(swatch, 'check');
      swatch.addEventListener('click', () => { if (!disabled) { this.actions.format(kind, color[kind]); this.closePanel(true); } });
      grid.append(swatch);
    }
    const reset = this.button(kind === 'foreground' ? 'resetForeground' : 'resetBackground');
    reset.classList.add('hover-bar-menu-item');
    reset.addEventListener('click', () => { this.actions.format(kind); this.closePanel(true); });
    this.panel.append(grid, reset); this.actions.resize();
    if (!this.touch || this.ownsFocus()) grid.querySelector('button')?.focus({ preventScroll: true });
  }

  private more(button: HTMLButtonElement): void {
    if (!this.startPanel('more', button)) return;
    const keys: (FormatAction & TextKey)[] = this.compact ? ['italic', 'code', 'highlight', 'clearColors'] : ['clearColors'];
    for (const key of keys) {
      const item = this.button(key); item.classList.add('hover-bar-menu-item');
      const disabled = !this.actions.available(key);
      item.setAttribute('aria-disabled', String(disabled));
      item.addEventListener('click', () => { if (!disabled) { this.actions.format(key); this.closePanel(true); } });
      this.panel.append(item);
    }
    this.actions.resize();
    if (!this.touch || this.ownsFocus()) this.focusable(this.panel)[0]?.focus({ preventScroll: true });
  }

  notePicker(button = this.controls.get('chooseNote')!): void {
    if (!this.startPanel('chooseNote', button)) return;
    const input = this.document.createElement('input');
    input.type = 'search'; input.placeholder = this.t('searchNotes'); input.setAttribute('aria-label', this.t('searchNotes'));
    input.className = 'hover-bar-search';
    const list = this.document.createElement('div'); list.className = 'hover-bar-notes';
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', this.t('searchNotes'));
    list.id = `hover-bar-notes-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
    const hint = this.document.createElement('div'); hint.className = 'hover-bar-hint'; hint.textContent = this.t('searchHint');
    let choices: readonly NoteChoice[] = []; let active = 0;
    const select = () => {
      for (let i = 0; i < list.children.length; i++) list.children[i]?.setAttribute('aria-selected', String(i === active));
      const option = list.children[active];
      if (option) { input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const search = async () => {
      this.queryAbort?.abort(); this.queryAbort = new AbortController();
      const id = ++this.queryId;
      list.setAttribute('aria-busy', 'true'); list.textContent = this.t('searching');
      choices = []; input.removeAttribute('aria-activedescendant');
      try { choices = await this.actions.notes(input.value, this.queryAbort.signal); }
      catch {
        if (id !== this.queryId) return;
        list.setAttribute('aria-busy', 'false'); list.textContent = this.t('searchError');
        const retry = this.button('retry'); retry.addEventListener('click', () => { void search(); });
        list.append(retry); this.actions.resize(); return;
      }
      if (id !== this.queryId) return;
      list.setAttribute('aria-busy', 'false');
      list.replaceChildren(); active = 0;
      for (const [index, note] of choices.entries()) {
        const row = this.document.createElement('div'); row.className = 'hover-bar-note';
        row.id = `${list.id}-${index}`; row.setAttribute('role', 'option');
        row.setAttribute('aria-disabled', String(!!note.disabled));
        if (note.disabled) row.setAttribute('aria-label', `${note.name} · ${note.path} · ${this.t('invalidLink')}`);
        const name = this.document.createElement('strong'); name.textContent = note.name;
        const path = this.document.createElement('small'); path.textContent = note.path;
        row.append(name, path); row.addEventListener('click', () => { if (!note.disabled) this.actions.selectNote(note.path); }); list.append(row);
      }
      if (!choices.length) { const empty = this.document.createElement('p'); empty.textContent = this.t('noNotes'); list.append(empty); }
      select(); this.actions.resize();
    };
    input.addEventListener('input', () => { void search(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        active = Math.max(0, Math.min(choices.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))); select();
      } else if (event.key === 'Enter') {
        event.preventDefault(); const choice = choices[active]; if (choice && !choice.disabled) this.actions.selectNote(choice.path);
      }
    });
    this.panel.append(input, list, hint); void search(); input.focus({ preventScroll: true }); this.actions.resize();
  }

  private focusable(container: HTMLElement): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden && button.getAttribute('aria-disabled') !== 'true' && !(this.compact && button.classList.contains('hover-bar-secondary') && button.getAttribute('aria-pressed') !== 'true'));
  }
  private roving(): void {
    const focusable = this.focusable(this.bar);
    for (const button of this.controls.values()) button.tabIndex = button === focusable[0] ? 0 : -1;
  }
  private onKey(event: KeyboardEvent): void {
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
