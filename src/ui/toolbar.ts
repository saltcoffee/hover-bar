import type { Translate } from '../i18n';
import { ACTION_IDS, fitLayout, type ActionId, type LayoutMetrics, type LayoutResult } from '../toolbar/layout';
import { actionButton, focusButton, setActionState } from './controls';
import { backState, expandedPanel, type PanelOrigin } from './panel-navigation';
import { ToolbarPanels, type PanelGeometry } from './toolbar-panels';
import type { Box } from './position';
import type { FormatId, PaletteKind, ToolbarActions, ToolbarId, ToolbarViewModel } from './toolbar-types';

export interface ToolbarMeasurement { readonly layout: LayoutResult; readonly panel: PanelGeometry; readonly fits: boolean }

export class Toolbar {
  readonly root: HTMLDivElement;
  readonly bar: HTMLDivElement;
  private readonly panels: ToolbarPanels;
  private readonly measurements: HTMLDivElement;
  private readonly controls = new Map<ToolbarId, HTMLButtonElement>();
  private readonly samples = new Map<ToolbarId, HTMLButtonElement>();
  private model: ToolbarViewModel | null = null;
  private visibleIds: readonly ActionId[] = [];
  private layoutKey = '';
  private geometryKey = '';
  private spaceFeedback = false;
  private lastActionOrigin: PanelOrigin | null = null;

  constructor(private readonly document: Document, private readonly t: Translate, private readonly actions: ToolbarActions) {
    this.root = document.createElement('div'); this.root.className = 'hover-bar-layer'; this.root.hidden = true;
    this.bar = document.createElement('div'); this.bar.className = 'hover-bar';
    this.bar.setAttribute('role', 'toolbar'); this.bar.setAttribute('aria-label', t('toolbar'));
    this.panels = new ToolbarPanels(document, t, actions, {
      activate: id => this.activate(id, 'more'), apply: (kind, color) => this.format(kind, color), back: () => this.back(),
    });
    this.measurements = document.createElement('div'); this.measurements.className = 'hover-bar-measurements';
    this.measurements.setAttribute('aria-hidden', 'true'); this.measurements.inert = true;
    this.root.append(this.bar, this.panels.root, this.measurements);
    for (const id of [...ACTION_IDS, 'more'] as const) {
      const button = actionButton(document, id, t); button.addEventListener('click', () => this.activate(id, 'bar'));
      this.controls.set(id, button);
      const sample = button.cloneNode(true) as HTMLButtonElement;
      sample.removeAttribute('data-action'); sample.tabIndex = -1;
      this.samples.set(id, sample); this.measurements.append(sample);
    }
    this.bar.append(this.controls.get('more')!);
    this.root.addEventListener('pointerdown', event => {
      // Preserve the editor selection; the search input retains its native behavior.
      if (event.button === 0 && event.composedPath().some(node =>
        (node as Element).tagName === 'BUTTON' || (node as Element).getAttribute?.('role') === 'option')) event.preventDefault();
    });
    this.root.addEventListener('keydown', event => this.onKey(event));
    this.root.addEventListener('contextmenu', event => {
      if (!event.composedPath().some(node => (node as Element).tagName === 'INPUT')) event.preventDefault();
    });
    document.body.append(this.root);
  }

  update(model: ToolbarViewModel): void {
    this.model = model;
    for (const [id, button] of this.controls) {
      setActionState(button, model.controls[id], this.t(id));
      setActionState(this.samples.get(id)!, model.controls[id], this.t(id));
    }
    this.panels.update(model); this.expanded(); this.roving();
  }

  show(): void {
    if (this.root.hidden) this.root.classList.add('is-measuring');
    this.root.hidden = false; this.roving();
  }
  positioned(left: number, top: number): void {
    this.root.style.setProperty('--hover-bar-left', `${left}px`); this.root.style.setProperty('--hover-bar-top', `${top}px`);
    this.root.classList.remove('is-measuring'); this.spaceFeedback = false;
  }
  focus(): void {
    const items = this.barButtons();
    focusButton(items.find(item => item.getAttribute('aria-disabled') !== 'true') ?? items[0]);
  }
  contains(event: Event): boolean { return event.composedPath().includes(this.root); }
  escape(): void { this.back(); }
  ownsFocus(): boolean { return this.root.contains(this.document.activeElement); }
  get visible(): boolean { return !this.root.hidden; }
  takeSpaceFeedback(): boolean { const value = this.spaceFeedback; this.spaceFeedback = false; return value; }
  hide(): void { this.panels.setState({ kind: 'none' }); this.spaceFeedback = false; this.lastActionOrigin = null; this.root.hidden = true; }
  destroy(): void { this.hide(); this.root.remove(); }

  private expanded(): void {
    for (const id of ['foreground', 'background', 'chooseNote', 'more'] as const) {
      const button = this.controls.get(id)!;
      button.setAttribute('aria-haspopup', id === 'chooseNote' ? 'dialog' : 'true');
      button.setAttribute('aria-expanded', String(expandedPanel(this.panels.state, id)));
    }
  }

  private origin(id: ActionId, source: 'bar' | 'more'): PanelOrigin {
    return source === 'more' ? { kind: 'more', actionId: id, scrollTop: this.panels.scrollTop } : { kind: 'bar', actionId: id };
  }
  private focusEntry(id: ActionId | 'more'): void {
    focusButton(this.controls.get(id === 'more' || this.visibleIds.includes(id) ? id : 'more'));
  }
  private bridgeFocus(): boolean {
    const owned = this.ownsFocus(); if (owned) this.focusEntry('more'); return owned;
  }

  private activate(id: ToolbarId, source: 'bar' | 'more'): void {
    if (!this.model) return;
    const state = this.model.controls[id];
    if (!state.enabled) { this.actions.explain(state.reason ?? this.t('failed')); return; }
    if (id === 'more') {
      if (expandedPanel(this.panels.state, 'more')) this.closePanels('more');
      else { this.bridgeFocus(); this.panels.setState({ kind: 'more', scrollTop: 0 }); this.panelOpened(); }
      return;
    }
    const origin = this.origin(id, source);
    if (id === 'foreground' || id === 'background' || id === 'chooseNote') {
      if (source === 'bar' && expandedPanel(this.panels.state, id)) { this.closePanels(id); return; }
      this.open(id, origin); return;
    }
    if (id === 'link') { this.lastActionOrigin = origin; this.actions.quickLink(); }
    else this.format(id);
  }

  private open(id: PaletteKind | 'chooseNote', origin: PanelOrigin): void {
    this.bridgeFocus();
    this.panels.setState(id === 'chooseNote' ? { kind: 'notes', origin } : { kind: 'palette', palette: id, origin });
    this.panelOpened();
  }
  private panelOpened(): void {
    this.spaceFeedback = true; this.expanded(); this.panels.focus(); this.actions.resize();
  }
  notePicker(): void {
    const origin = this.lastActionOrigin ?? this.origin('chooseNote', this.visibleIds.includes('chooseNote') ? 'bar' : 'more');
    this.open('chooseNote', origin);
  }

  private format(id: FormatId, color?: string): void {
    const owned = this.ownsFocus();
    const outcome = this.actions.format(id, color);
    if (!this.visible || outcome.kind === 'closed') return;
    if (outcome.kind === 'applied' || outcome.kind === 'unchanged') {
      if (owned) this.focusEntry(id);
      this.panels.setState({ kind: 'none' }); this.expanded();
      this.actions.resize();
    }
  }

  private closePanels(id: ActionId | 'more'): void {
    const owned = this.ownsFocus(); if (owned) this.focusEntry(id);
    this.panels.setState({ kind: 'none' }); this.expanded(); this.actions.resize();
  }
  private back(): void {
    const state = this.panels.state;
    if (state.kind === 'none') { this.actions.close(); return; }
    const owned = this.bridgeFocus();
    const next = backState(state); this.panels.setState(next); this.expanded();
    if (owned) {
      if (next.kind === 'more' && next.focusId) {
        if (!this.panels.focusAction(next.focusId)) {
          if (this.visibleIds.includes(next.focusId)) this.focusEntry(next.focusId); else this.panels.focus();
        }
      } else this.focusEntry(state.kind === 'more' ? 'more' : state.origin.actionId);
    }
    this.actions.resize();
  }

  readLayout(bounds: Box, availableHeight: number): ToolbarMeasurement {
    if (!this.model) throw new Error('Toolbar model is missing');
    const window = this.document.defaultView!;
    const style = window.getComputedStyle(this.bar);
    const number = (value: string) => Number.parseFloat(value) || 0;
    const widths = Object.fromEntries([...this.samples].map(([id, button]) => [id, Math.max(32, button.getBoundingClientRect().width)])) as Record<ToolbarId, number>;
    const metrics: LayoutMetrics = { widths,
      shell: number(style.paddingLeft) + number(style.paddingRight) + number(style.borderLeftWidth) + number(style.borderRightWidth),
      gap: number(style.gap), groupGap: number(style.getPropertyValue('--hover-bar-group-gap')),
    };
    const budget = bounds.right - bounds.left - 16;
    const layout = fitLayout(this.model.layout, metrics, budget);
    const panel = this.panels.readGeometry(Math.min(292, budget), availableHeight - this.bar.getBoundingClientRect().height - 6);
    return { layout, panel, fits: layout.fits && panel.fits };
  }

  applyLayout(measurement: ToolbarMeasurement): boolean {
    const ids = measurement.layout.bar;
    const key = `${ids.join(',')}:${this.model!.layout.grouped}`;
    const active = this.document.activeElement as HTMLElement | null;
    const actionId = active?.dataset.action as ActionId | undefined;
    const hadBarFocus = !!active && this.bar.contains(active);
    const hadPanelFocus = !!active && this.panels.body.contains(active);
    let changed = false;
    if (key !== this.layoutKey) {
      if (hadBarFocus || (hadPanelFocus && actionId && ids.includes(actionId))) this.focusEntry('more');
      this.visibleIds = [...ids];
      // Remove old locations before exposing the new bar, so each intent has one visible entry.
      this.panels.setOverflow(measurement.layout.overflow);
      const buttons = [...ids, 'more' as const].map((id, index) => {
        const button = this.controls.get(id)!;
        button.classList.toggle('hover-bar-group-start', this.model!.layout.grouped && index > 0 && (id === 'foreground' || id === 'link'));
        return button;
      });
      this.bar.replaceChildren(...buttons); this.layoutKey = key; changed = true;
      if (hadBarFocus && actionId) this.focusEntry(actionId);
      else if (hadPanelFocus && actionId && ids.includes(actionId)) this.focusEntry(actionId);
      this.roving();
    } else this.panels.setOverflow(measurement.layout.overflow);
    const geometryKey = JSON.stringify(measurement.panel);
    if (this.panels.visible && geometryKey !== this.geometryKey) {
      changed = this.panels.applyGeometry(measurement.panel) || changed;
      this.geometryKey = geometryKey;
    }
    return changed;
  }

  private barButtons(): HTMLButtonElement[] { return [...this.bar.querySelectorAll<HTMLButtonElement>('button')]; }
  private roving(): void {
    const items = this.barButtons();
    const selected = items.find(item => item === this.document.activeElement) ?? items.find(item => item.getAttribute('aria-disabled') !== 'true') ?? items[0];
    for (const button of items) button.tabIndex = button === selected ? 0 : -1;
  }
  private onKey(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.back(); return; }
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    if (this.panels.root.contains(event.target as Node)) {
      if (event.key === 'Tab' && event.shiftKey && event.target === this.panels.back) {
        const state = this.panels.state;
        this.focusEntry(state.kind === 'palette' || state.kind === 'notes' ? state.origin.kind === 'bar' ? state.origin.actionId : 'more' : 'more');
        event.preventDefault(); event.stopPropagation();
      } else if (this.panels.onKey(event)) event.stopPropagation();
      return;
    }
    if (!this.bar.contains(event.target as Node)) return;
    if (event.key === 'Tab' && !event.shiftKey && this.panels.visible) {
      event.preventDefault(); event.stopPropagation(); focusButton(this.panels.back); return;
    }
    const items = this.barButtons(); const index = items.indexOf(this.document.activeElement as HTMLButtonElement);
    const step = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : step ? (index + step + items.length) % items.length : -1;
    if (next < 0) return;
    event.preventDefault(); focusButton(items[next]); this.roving();
  }
}
