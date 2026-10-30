import { setIcon } from 'obsidian';
import type { Translate } from '../i18n';
import type { ActionId } from '../toolbar/layout';
import { paletteColumns } from '../toolbar/layout';
import { actionButton, focusButton, setActionState } from './controls';
import { NotePicker } from './note-picker';
import type { PanelState } from './panel-navigation';
import type { PaletteKind, ToolbarActions, ToolbarViewModel } from './toolbar-types';

interface Callbacks { activate(id: ActionId): void; apply(kind: PaletteKind, color?: string): void; back(): void }
export interface PanelGeometry { readonly fits: boolean; readonly width: number; readonly bodyHeight: number; readonly columns: number }

export class ToolbarPanels {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly back: HTMLButtonElement;
  state: PanelState = { kind: 'none' };
  private model: ToolbarViewModel | null = null;
  private overflow: readonly ActionId[] = [];
  private picker: NotePicker | null = null;
  private menuRows = new Map<ActionId, HTMLButtonElement>();
  private swatches = new Map<string, HTMLButtonElement>();
  private reset: HTMLButtonElement | null = null;
  private columns = 4;

  constructor(private readonly document: Document, private readonly t: Translate, private readonly actions: ToolbarActions, private readonly callbacks: Callbacks) {
    this.root = document.createElement('div'); this.root.className = 'hover-bar-panel'; this.root.hidden = true;
    this.back = document.createElement('button'); this.back.type = 'button'; this.back.className = 'hover-bar-button hover-bar-menu-item hover-bar-back'; this.back.textContent = t('back');
    this.back.addEventListener('click', () => callbacks.back());
    this.body = document.createElement('div'); this.body.className = 'hover-bar-panel-body'; this.root.append(this.back, this.body);
  }

  get scrollTop(): number { return this.body.scrollTop; }
  get visible(): boolean { return this.state.kind !== 'none'; }
  setState(state: PanelState): void {
    this.picker?.cancel(); this.picker = null; this.state = state;
    this.body.replaceChildren(); this.menuRows.clear(); this.swatches.clear(); this.reset = null;
    this.root.hidden = state.kind === 'none';
    if (state.kind === 'none') return;
    this.root.setAttribute('role', state.kind === 'notes' ? 'dialog' : 'group');
    this.root.setAttribute('aria-label', this.t(state.kind === 'palette' ? state.palette : state.kind === 'notes' ? 'chooseNote' : 'more'));
    if (state.kind === 'more') { this.renderMore(); this.body.scrollTop = state.scrollTop; }
    else if (state.kind === 'palette') this.renderPalette(state.palette);
    else this.picker = new NotePicker(this.document, this.body, this.t, this.actions);
  }

  update(model: ToolbarViewModel): void {
    this.model = model;
    for (const [id, row] of this.menuRows) setActionState(row, model.controls[id], this.t(id));
    if (this.state.kind !== 'palette') return;
    const kind = this.state.palette;
    for (const color of model.palettes[kind]) {
      const swatch = this.swatches.get(color.id);
      if (!swatch) continue;
      setActionState(swatch, color, color.label); swatch.replaceChildren();
      if (color.pressed) setIcon(swatch, 'check');
    }
    if (this.reset) setActionState(this.reset, model.resets[kind], this.t(kind === 'foreground' ? 'resetForeground' : 'resetBackground'));
  }

  setOverflow(ids: readonly ActionId[]): void {
    if (ids.length === this.overflow.length && ids.every((id, index) => id === this.overflow[index])) return;
    this.overflow = [...ids];
    if (this.state.kind !== 'more') return;
    const focused = this.document.activeElement as HTMLElement | null;
    const activeId = focused?.dataset.action as ActionId | undefined;
    const owned = !!focused && this.body.contains(focused);
    const scroll = this.body.scrollTop;
    if (owned) focusButton(this.back);
    this.body.replaceChildren(); this.menuRows.clear(); this.renderMore();
    this.body.scrollTop = Math.min(scroll, Math.max(0, this.body.scrollHeight - this.body.clientHeight));
    if (owned && activeId) this.focusAction(activeId);
  }

  private renderMore(): void {
    for (const id of this.overflow) {
      const row = actionButton(this.document, id, this.t, true);
      if (id === 'foreground' || id === 'background' || id === 'chooseNote') { row.setAttribute('aria-haspopup', id === 'chooseNote' ? 'dialog' : 'true'); row.classList.add('hover-bar-subpage'); }
      row.addEventListener('click', () => this.callbacks.activate(id)); this.menuRows.set(id, row); this.body.append(row);
    }
    if (!this.overflow.length) { const empty = this.document.createElement('p'); empty.textContent = this.t('allVisible'); this.body.append(empty); }
    if (this.model) this.update(this.model);
  }

  private renderPalette(kind: PaletteKind): void {
    if (!this.model) return;
    const grid = this.document.createElement('div'); grid.className = 'hover-bar-palette'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', this.t(kind));
    for (const color of this.model.palettes[kind]) {
      const swatch = this.document.createElement('button'); swatch.type = 'button'; swatch.tabIndex = -1;
      swatch.className = `hover-bar-swatch hover-bar-${kind}-${color.id}`; swatch.dataset.swatch = color.id;
      swatch.addEventListener('click', () => {
        const current = this.model?.palettes[kind].find(item => item.id === color.id);
        if (current?.enabled) this.callbacks.apply(kind, current.color); else if (current?.reason) this.actions.explain(current.reason);
      });
      grid.append(swatch); this.swatches.set(color.id, swatch);
    }
    this.reset = this.document.createElement('button'); this.reset.type = 'button'; this.reset.className = 'hover-bar-button hover-bar-menu-item';
    this.reset.textContent = this.t(kind === 'foreground' ? 'resetForeground' : 'resetBackground');
    this.reset.addEventListener('click', () => {
      const current = this.model?.resets[kind];
      if (current?.enabled) this.callbacks.apply(kind); else if (current?.reason) this.actions.explain(current.reason);
    });
    this.body.append(grid, this.reset); this.update(this.model);
    const first = [...this.swatches.values()][0]; if (first) first.tabIndex = 0;
  }

  focus(): void {
    if (this.state.kind === 'notes') { this.body.querySelector('input')?.focus({ preventScroll: true }); return; }
    focusButton(this.state.kind === 'palette' ? [...this.swatches.values()][0] : this.menuRows.values().next().value ?? this.back);
  }
  focusAction(id: ActionId): boolean {
    const button = this.menuRows.get(id);
    if (!button) return false;
    focusButton(button); this.ensureVisible(button); return true;
  }

  private ensureVisible(target: HTMLElement): void {
    if (!this.body.contains(target)) return;
    const bounds = this.body.getBoundingClientRect(), item = target.getBoundingClientRect();
    if (item.top < bounds.top) this.body.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) this.body.scrollTop += item.bottom - bounds.bottom;
  }

  readGeometry(width: number, height: number): PanelGeometry {
    if (!this.visible) return { fits: true, width, bodyHeight: 0, columns: 4 };
    const window = this.document.defaultView!;
    const style = window.getComputedStyle(this.root), back = this.back.getBoundingClientRect();
    const number = (value: string) => Number.parseFloat(value) || 0;
    const content = width - number(style.paddingLeft) - number(style.paddingRight) - number(style.borderLeftWidth) - number(style.borderRightWidth);
    const shell = number(style.paddingTop) + number(style.paddingBottom) + number(style.borderTopWidth) + number(style.borderBottomWidth);
    const bodyHeight = Math.floor(height - shell - Math.max(32, back.height) - 8);
    const minimum = this.state.kind === 'palette' ? 36 : this.state.kind === 'notes' ? 72 : 32;
    const gridStyle = this.body.querySelector('.hover-bar-palette');
    const gap = gridStyle ? number(window.getComputedStyle(gridStyle).gap) : 8;
    const columns = paletteColumns(content, number(style.getPropertyValue('--hover-bar-swatch-min-size')) || 32, gap);
    return { width, bodyHeight, columns, fits: content >= 32 && bodyHeight >= minimum && (this.state.kind !== 'palette' || columns >= 1) };
  }

  applyGeometry(geometry: PanelGeometry): boolean {
    if (!this.visible) return false;
    const width = `${geometry.width}px`, height = `${geometry.bodyHeight}px`, columns = String(geometry.columns);
    const changed = this.root.style.width !== width || this.body.style.maxHeight !== height || this.root.style.getPropertyValue('--hover-bar-palette-columns') !== columns;
    if (changed) { this.root.style.width = width; this.body.style.maxHeight = height; this.root.style.setProperty('--hover-bar-palette-columns', columns); }
    this.columns = geometry.columns; return changed;
  }

  onKey(event: KeyboardEvent): boolean {
    if (this.state.kind === 'notes' || this.state.kind === 'none') return false;
    const active = this.document.activeElement;
    const swatches = [...this.swatches.values()]; const index = swatches.indexOf(active as HTMLButtonElement);
    let target: HTMLElement | undefined;
    if (this.state.kind === 'palette') {
      const tabStop = swatches.find(button => button.tabIndex === 0) ?? swatches[0];
      if (event.key === 'Tab') {
        if (active === this.back && !event.shiftKey) target = tabStop;
        else if (index >= 0) target = event.shiftKey ? this.back : this.reset!;
        else if (active === this.reset && event.shiftKey) target = tabStop;
      } else if (index >= 0) {
        if (event.key === 'Home') target = swatches[0];
        else if (event.key === 'End') target = swatches.at(-1);
        else if (event.key === 'ArrowLeft') target = swatches[Math.max(0, index - 1)];
        else if (event.key === 'ArrowRight') target = swatches[Math.min(swatches.length - 1, index + 1)];
        else if (event.key === 'ArrowUp') target = index < this.columns ? this.back : swatches[index - this.columns];
        else if (event.key === 'ArrowDown') target = Math.floor(index / this.columns) === Math.floor((swatches.length - 1) / this.columns) ? this.reset! : swatches[Math.min(swatches.length - 1, index + this.columns)];
      } else if (active === this.back && event.key === 'ArrowDown') target = swatches[0];
      else if (active === this.reset && event.key === 'ArrowUp') target = swatches.at(-1);
      if (target && swatches.includes(target as HTMLButtonElement)) for (const button of swatches) button.tabIndex = button === target ? 0 : -1;
    } else {
      const items = [this.back, ...this.menuRows.values()];
      const index = items.indexOf(active as HTMLButtonElement);
      const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
      const tabIndex = index + (event.shiftKey ? -1 : 1);
      target = event.key === 'Tab' ? items[tabIndex] : event.key === 'Home' ? items[0] : event.key === 'End' ? items.at(-1) : step ? items[(index + step + items.length) % items.length] : undefined;
    }
    if (!target) return false;
    event.preventDefault(); focusButton(target); this.ensureVisible(target); return true;
  }
}
