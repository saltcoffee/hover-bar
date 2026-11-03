import { setIcon } from 'obsidian';
import type { Translate } from '../i18n';
import { isCanonicalHex, normalizeHex } from '../formatting/colors';
import { focusButton, setActionState } from './controls';
import type { PaletteKind, SwatchView, ToolbarActions, ToolbarViewModel } from './toolbar-types';

type Group = 'recent' | 'presets';
interface Grid { root: HTMLDivElement; buttons: Map<string, HTMLButtonElement>; order: readonly SwatchView[] }

export class ColorPalette {
  private readonly grids: Record<Group, Grid>;
  readonly input: HTMLInputElement;
  readonly apply: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
  private readonly empty: HTMLParagraphElement;
  private readonly error: HTMLParagraphElement;
  private readonly preview: HTMLDivElement;
  private model: ToolbarViewModel | null = null;
  private columns = 4;
  private composing = false;
  private confirming = false;
  private composingEnterHeld = false;
  private compositionTimer = 0;
  private focusVisibilityRequested = false;

  constructor(private readonly document: Document, private readonly body: HTMLElement, private readonly back: HTMLButtonElement,
    private readonly kind: PaletteKind, private readonly t: Translate, private readonly actions: ToolbarActions,
    private readonly submit: (kind: PaletteKind, color?: string) => void, model: ToolbarViewModel) {
    const grid = (label: string): Grid => {
      const heading = document.createElement('h4'); heading.className = 'hover-bar-palette-heading'; heading.textContent = label;
      const root = document.createElement('div'); root.className = 'hover-bar-palette'; root.setAttribute('role', 'group'); root.setAttribute('aria-label', label);
      body.append(heading, root); return { root, buttons: new Map(), order: [] };
    };
    this.grids = { recent: grid(t('recentColors')), presets: grid(t('presetColors')) };
    this.empty = document.createElement('p'); this.empty.className = 'hover-bar-hint'; this.empty.textContent = t('noRecentColors');
    this.grids.recent.root.after(this.empty);
    const custom = document.createElement('div'); custom.className = 'hover-bar-custom-color';
    const heading = document.createElement('h4'); heading.className = 'hover-bar-palette-heading'; heading.textContent = t('customColor');
    const label = document.createElement('label'); label.textContent = t('hexColor');
    this.input = document.createElement('input'); this.input.type = 'text'; this.input.className = 'hover-bar-hex';
    this.input.id = `hover-bar-hex-${Math.random().toString(36).slice(2)}`; label.htmlFor = this.input.id;
    this.input.spellcheck = false; this.input.autocomplete = 'off'; this.input.value = model.colors[kind] ?? '';
    const hint = document.createElement('p'); hint.className = 'hover-bar-hint'; hint.textContent = t('hexHint'); hint.id = `${this.input.id}-hint`;
    this.error = document.createElement('p'); this.error.className = 'hover-bar-color-error'; this.error.id = `${this.input.id}-error`;
    this.error.setAttribute('role', 'status'); this.error.setAttribute('aria-live', 'polite');
    this.input.setAttribute('aria-describedby', `${hint.id} ${this.error.id}`);
    this.preview = document.createElement('div'); this.preview.className = 'hover-bar-color-sample';
    this.apply = document.createElement('button'); this.apply.type = 'button'; this.apply.className = 'hover-bar-button hover-bar-menu-item hover-bar-apply-color'; this.apply.textContent = t('applyColor');
    this.apply.addEventListener('click', () => this.applyColor());
    this.input.addEventListener('input', () => this.updateDraft());
    this.input.addEventListener('compositionstart', () => { this.composing = true; });
    this.input.addEventListener('compositionend', () => {
      this.composing = false; this.confirming = true;
      // This short guard must not release an Enter that is still held down.
      this.document.defaultView!.clearTimeout(this.compositionTimer);
      this.compositionTimer = this.document.defaultView!.setTimeout(() => { this.confirming = false; }, 0);
    });
    this.input.addEventListener('keyup', event => { if (event.key === 'Enter') { this.confirming = false; this.composingEnterHeld = false; } });
    this.input.addEventListener('blur', () => { this.composingEnterHeld = false; });
    this.input.addEventListener('keydown', event => {
      if (this.composing || this.confirming || event.isComposing || event.keyCode === 229 || (event.key === 'Enter' && this.composingEnterHeld)) {
        if (event.key === 'Enter') this.composingEnterHeld = true;
        event.stopPropagation(); return;
      }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.applyColor(); }
    });
    custom.append(heading, label, this.input, hint, this.preview, this.apply, this.error);
    this.reset = document.createElement('button'); this.reset.type = 'button'; this.reset.className = 'hover-bar-button hover-bar-menu-item hover-bar-reset-color';
    this.reset.textContent = t(kind === 'foreground' ? 'resetForeground' : 'resetBackground');
    this.reset.addEventListener('click', () => {
      const state = this.model?.resets[kind];
      if (state?.enabled) this.submit(kind); else if (state?.reason) this.actions.explain(state.reason);
    });
    body.append(custom, this.reset); this.update(model);
  }

  update(model: ToolbarViewModel): void {
    const scroll = this.body.scrollTop;
    this.model = model;
    this.updateGrid('recent', model.recent[this.kind]); this.updateGrid('presets', model.palettes[this.kind]);
    this.empty.hidden = model.recent[this.kind].length > 0;
    this.grids.recent.root.hidden = !model.recent[this.kind].length;
    setActionState(this.reset, model.resets[this.kind], this.t(this.kind === 'foreground' ? 'resetForeground' : 'resetBackground'));
    this.updateDraft();
    this.body.scrollTop = scroll;
  }
  private updateGrid(group: Group, colors: readonly SwatchView[]): void {
    const grid = this.grids[group];
    const active = this.document.activeElement;
    const focused = [...grid.buttons.entries()].find(([, button]) => button === active)?.[0];
    for (const color of colors) {
      if (!isCanonicalHex(color.color)) continue;
      let button = grid.buttons.get(color.color);
      if (!button) {
        button = this.document.createElement('button'); button.type = 'button'; button.tabIndex = -1;
        button.className = 'hover-bar-swatch'; button.dataset.swatch = color.id;
        button.style.setProperty('--hover-bar-swatch', color.color);
        button.addEventListener('click', () => {
          const current = grid.order.find(item => item.color === color.color);
          if (!this.model) return;
          if (current?.enabled) this.submit(this.kind, current.color); else if (current?.reason) this.actions.explain(current.reason);
        });
        grid.buttons.set(color.color, button); grid.root.append(button);
      }
      setActionState(button, color, color.label); button.replaceChildren();
      if (color.pressed) setIcon(button, 'check');
    }
    const keys = new Set(colors.map(color => color.color));
    if (focused && !keys.has(focused)) { focusButton(colors[0] ? grid.buttons.get(colors[0].color) : this.back); this.focusVisibilityRequested = true; }
    for (const [color, button] of grid.buttons) if (!keys.has(color)) { button.remove(); grid.buttons.delete(color); }
    const ordered = colors.map(color => grid.buttons.get(color.color)!).filter(Boolean);
    const anchor = ordered.find(button => button === this.document.activeElement);
    // Move only siblings around a retained focus node; detaching that node would
    // transiently focus body and close the controller's active session.
    if (anchor) {
      const index = ordered.indexOf(anchor);
      for (const button of ordered.slice(0, index)) grid.root.insertBefore(button, anchor);
      for (const button of ordered.slice(index + 1)) grid.root.append(button);
    } else for (const button of ordered) grid.root.append(button);
    const stop = anchor ?? ordered.find(button => button.tabIndex === 0) ?? ordered[0];
    for (const button of ordered) button.tabIndex = button === stop ? 0 : -1;
    grid.order = colors;
  }
  private updateDraft(): void {
    const color = normalizeHex(this.input.value);
    const invalid = this.input.value.length > 0 && !color;
    this.input.setAttribute('aria-invalid', String(invalid));
    this.error.textContent = invalid ? this.t('invalidColor') : '';
    this.apply.disabled = !color;
    this.preview.textContent = color ? `${this.t('colorSample')} · ${color}` : this.t('colorSample');
    this.preview.style.removeProperty('--hover-bar-foreground'); this.preview.style.removeProperty('--hover-bar-background');
    this.preview.className = 'hover-bar-color-sample';
    if (color) { this.preview.classList.add(`hover-bar-color-${this.kind}`); this.preview.style.setProperty(`--hover-bar-${this.kind}`, color); }
  }
  private applyColor(): void {
    if (!this.model || this.composing) return;
    const color = normalizeHex(this.input.value);
    if (color) this.submit(this.kind, color);
    else { this.error.textContent = this.t('invalidColor'); this.input.setAttribute('aria-invalid', 'true'); }
  }
  setColumns(columns: number): void { this.columns = columns; }
  focus(): void { focusButton(this.firstButton() ?? this.back); this.focusVisibilityRequested = true; }
  readScrollTop(bodyHeight: number): number {
    const current = this.body.scrollTop, active = this.document.activeElement;
    if (!this.focusVisibilityRequested || !active || !this.body.contains(active)) return current;
    const bounds = this.body.getBoundingClientRect(), item = active.getBoundingClientRect();
    const height = Math.min(bounds.height, Math.max(0, bodyHeight));
    if (item.top < bounds.top || item.height > height) return Math.max(0, Math.floor(current + item.top - bounds.top));
    return item.bottom > bounds.top + height ? Math.ceil(current + item.bottom - bounds.top - height) : current;
  }
  applyScrollTop(scrollTop: number, geometryChanged: boolean): boolean {
    const previous = this.body.scrollTop;
    if (scrollTop !== previous) this.body.scrollTop = scrollTop;
    // Width and column changes need another read using the resulting layout.
    this.focusVisibilityRequested = geometryChanged;
    return this.body.scrollTop !== previous;
  }
  private firstButton(): HTMLButtonElement | undefined {
    for (const group of ['recent', 'presets'] as const) {
      const grid = this.grids[group], first = grid.order[0]; if (first) return grid.buttons.get(first.color);
    }
    return undefined;
  }
  onKey(event: KeyboardEvent): boolean {
    const active = this.document.activeElement;
    if (active === this.input) return false;
    let target: HTMLElement | undefined;
    const stops: HTMLElement[] = [this.back, ...(['recent', 'presets'] as const).flatMap(group => {
      const grid = this.grids[group]; return [...grid.buttons.values()].filter(button => button.tabIndex === 0);
    }), this.input, ...(!this.apply.disabled ? [this.apply] : []), this.reset];
    if (event.key === 'Tab') target = stops[stops.indexOf(active as HTMLElement) + (event.shiftKey ? -1 : 1)];
    else {
      for (const group of ['recent', 'presets'] as const) {
        const grid = this.grids[group], buttons = grid.order.map(color => grid.buttons.get(color.color)!);
        const index = buttons.indexOf(active as HTMLButtonElement);
        if (index < 0) continue;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'ArrowRight' ? Math.min(buttons.length - 1, index + 1)
          : event.key === 'ArrowUp' ? Math.max(0, index - this.columns) : event.key === 'ArrowDown' ? Math.min(buttons.length - 1, index + this.columns) : -1;
        if (next >= 0) {
          target = buttons[next]; for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
        }
      }
      if (active === this.back && event.key === 'ArrowDown') target = this.firstButton();
    }
    if (!target) return false;
    event.preventDefault(); focusButton(target);
    const bounds = this.body.getBoundingClientRect(), item = target.getBoundingClientRect();
    if (item.top < bounds.top) this.body.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) this.body.scrollTop += item.bottom - bounds.bottom;
    return true;
  }
  dispose(): void { this.model = null; this.document.defaultView!.clearTimeout(this.compositionTimer); }
}
