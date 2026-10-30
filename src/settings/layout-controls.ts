import type { Translate } from '../i18n';
import { ACTION_IDS, resolveLayout, type ActionId } from '../toolbar/layout';
import type { PreferencesStore } from './store';

interface Row { element: HTMLLIElement; label: HTMLSpanElement; toggle: HTMLButtonElement; up: HTMLButtonElement; down: HTMLButtonElement }

export class LayoutControls {
  readonly heading: HTMLHeadingElement;
  private readonly pinned: HTMLOListElement;
  private readonly unpinned: HTMLUListElement;
  private readonly mode: HTMLParagraphElement;
  private readonly announcement: HTMLParagraphElement;
  private readonly reset: HTMLButtonElement;
  private readonly rows = new Map<ActionId, Row>();
  private readonly emptyPinned: HTMLParagraphElement;
  private readonly emptyUnpinned: HTMLParagraphElement;

  constructor(private readonly root: HTMLElement, private readonly store: PreferencesStore, private readonly t: Translate) {
    const doc = root.ownerDocument;
    this.heading = doc.createElement('h3'); this.heading.textContent = t('layout'); this.heading.tabIndex = -1;
    this.mode = doc.createElement('p'); this.mode.className = 'setting-item-description';
    const description = doc.createElement('p'); description.textContent = t('layoutDesc'); description.className = 'setting-item-description';
    const cost = doc.createElement('p'); cost.textContent = t('layoutCost'); cost.className = 'setting-item-description';
    const pinnedTitle = doc.createElement('h4'); pinnedTitle.textContent = t('pinned');
    this.pinned = doc.createElement('ol'); this.pinned.className = 'hover-bar-layout-list'; this.pinned.setAttribute('aria-label', t('pinned'));
    const unpinnedTitle = doc.createElement('h4'); unpinnedTitle.textContent = t('unpinned');
    this.unpinned = doc.createElement('ul'); this.unpinned.className = 'hover-bar-layout-list'; this.unpinned.setAttribute('aria-label', t('unpinned'));
    this.emptyPinned = doc.createElement('p'); this.emptyPinned.textContent = t('noPinned');
    this.emptyUnpinned = doc.createElement('p'); this.emptyUnpinned.textContent = t('allPinned');
    this.reset = this.button(t('resetLayout')); this.reset.addEventListener('click', () => { void store.resetLayout(); this.announce(t('layoutRestored')); });
    this.announcement = doc.createElement('p'); this.announcement.className = 'hover-bar-settings-feedback'; this.announcement.setAttribute('role', 'status'); this.announcement.setAttribute('aria-live', 'polite');
    root.append(this.heading, this.mode, description, cost, pinnedTitle, this.pinned, this.emptyPinned, unpinnedTitle, this.unpinned, this.emptyUnpinned, this.reset, this.announcement);
    for (const id of ACTION_IDS) {
      const element = doc.createElement('li'); element.className = 'hover-bar-layout-row'; element.dataset.action = id;
      const label = doc.createElement('span'); label.className = 'hover-bar-layout-label';
      const toggle = this.button(''), up = this.button(t('moveUp')), down = this.button(t('moveDown'));
      toggle.dataset.control = 'toggle'; up.dataset.control = 'up'; down.dataset.control = 'down';
      toggle.addEventListener('click', () => this.change(id, 'toggle'));
      up.addEventListener('click', () => this.change(id, 'up')); down.addEventListener('click', () => this.change(id, 'down'));
      const controls = doc.createElement('div'); controls.className = 'hover-bar-layout-controls'; controls.append(toggle, up, down);
      element.append(label, controls); this.rows.set(id, { element, label, toggle, up, down });
    }
    this.update();
  }

  private button(label: string): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button'); button.type = 'button'; button.textContent = label; return button;
  }
  private announce(message: string): void { this.announcement.textContent = message; }
  focus(): void { this.heading.focus({ preventScroll: true }); }

  private change(id: ActionId, control: 'toggle' | 'up' | 'down'): void {
    if (!this.store.enabled) return;
    const pinned = [...resolveLayout(this.store.value.toolbar).pinned];
    const index = pinned.indexOf(id);
    if (control === 'toggle') {
      if (index < 0) pinned.push(id); else pinned.splice(index, 1);
    } else {
      const target = index + (control === 'up' ? -1 : 1);
      if (index < 0 || target < 0 || target >= pinned.length) return;
      [pinned[index], pinned[target]] = [pinned[target]!, pinned[index]!];
    }
    void this.store.setLayout({ kind: 'custom', pinned });
    const position = pinned.indexOf(id);
    this.announce(position < 0 ? this.t('actionUnpinned', { name: this.t(id) }) : this.t('actionPosition', { name: this.t(id), position: position + 1, total: pinned.length }));
  }

  update(): void {
    const doc = this.root.ownerDocument;
    const active = doc.activeElement as HTMLElement | null;
    const focused = active?.closest<HTMLElement>('[data-action]');
    const id = focused?.dataset.action as ActionId | undefined;
    const control = active?.dataset.control as 'toggle' | 'up' | 'down' | undefined;
    const hadRowFocus = !!focused && this.root.contains(focused);
    if (hadRowFocus) this.focus();
    const view = resolveLayout(this.store.value.toolbar);
    this.mode.textContent = this.t(this.store.value.toolbar.kind === 'default' ? 'defaultLayout' : 'customLayout');
    for (const action of [...view.pinned, ...view.unpinned]) {
      const row = this.rows.get(action)!;
      const index = view.pinned.indexOf(action), pinned = index >= 0;
      row.label.textContent = pinned ? `${index + 1}. ${this.t(action)}` : this.t(action);
      row.toggle.textContent = this.t(pinned ? 'unpin' : 'pin');
      row.toggle.setAttribute('aria-label', `${row.toggle.textContent} ${this.t(action)}`);
      row.up.setAttribute('aria-label', `${this.t('moveUp')} ${this.t(action)}`); row.down.setAttribute('aria-label', `${this.t('moveDown')} ${this.t(action)}`);
      row.up.hidden = row.down.hidden = !pinned;
      row.up.disabled = !this.store.enabled || index <= 0;
      row.down.disabled = !this.store.enabled || index < 0 || index === view.pinned.length - 1;
      (pinned ? this.pinned : this.unpinned).append(row.element);
    }
    this.emptyPinned.hidden = view.pinned.length !== 0; this.emptyUnpinned.hidden = view.unpinned.length !== 0;
    this.updateAvailability();
    if (hadRowFocus && id) {
      const row = this.rows.get(id)!;
      const target = control ? row[control] : row.toggle;
      (target.hidden || target.disabled ? row.toggle : target).focus({ preventScroll: true });
    }
  }

  updateAvailability(): void {
    const pinned = resolveLayout(this.store.value.toolbar).pinned;
    for (const [id, row] of this.rows) {
      const index = pinned.indexOf(id);
      row.toggle.disabled = !this.store.enabled;
      row.up.disabled = !this.store.enabled || index <= 0;
      row.down.disabled = !this.store.enabled || index < 0 || index === pinned.length - 1;
    }
    this.reset.disabled = !this.store.enabled;
  }
}
