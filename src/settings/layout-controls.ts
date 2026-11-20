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
    root.classList.add('hover-bar-layout-settings');
    this.heading = root.createEl('h3', { cls: 'hover-bar-layout-heading', text: t('layout') }); this.heading.tabIndex = -1;
    this.mode = root.createEl('p', { cls: 'setting-item-description hover-bar-layout-description' });
    root.createEl('p', { cls: 'setting-item-description hover-bar-layout-description', text: t('layoutDesc') });
    root.createEl('p', { cls: 'setting-item-description hover-bar-layout-description', text: t('layoutCost') });
    root.createEl('h4', { cls: 'hover-bar-layout-subheading', text: t('pinned') });
    this.pinned = root.createEl('ol', { cls: 'hover-bar-layout-list', attr: { 'aria-label': t('pinned') } });
    this.emptyPinned = root.createEl('p', { text: t('noPinned') });
    root.createEl('h4', { cls: 'hover-bar-layout-subheading', text: t('unpinned') });
    this.unpinned = root.createEl('ul', { cls: 'hover-bar-layout-list', attr: { 'aria-label': t('unpinned') } });
    this.emptyUnpinned = root.createEl('p', { text: t('allPinned') });
    const footer = root.createDiv({ cls: 'hover-bar-layout-footer' });
    this.announcement = footer.createEl('p', { cls: 'hover-bar-settings-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
    this.reset = this.button(footer, t('resetLayout'));
    this.reset.addEventListener('click', () => { void store.resetLayout(); this.announce(t('layoutRestored')); });
    for (const id of ACTION_IDS) {
      const element = this.unpinned.createEl('li', { cls: 'hover-bar-layout-row' }); element.dataset.action = id;
      const label = element.createSpan({ cls: 'hover-bar-layout-label' });
      const controls = element.createDiv({ cls: 'hover-bar-layout-controls' });
      const toggle = this.button(controls, ''), up = this.button(controls, t('moveUp')), down = this.button(controls, t('moveDown'));
      toggle.dataset.control = 'toggle'; up.dataset.control = 'up'; down.dataset.control = 'down';
      toggle.addEventListener('click', () => this.change(id, 'toggle'));
      up.addEventListener('click', () => this.change(id, 'up')); down.addEventListener('click', () => this.change(id, 'down'));
      this.rows.set(id, { element, label, toggle, up, down });
    }
    this.update();
  }

  private button(parent: HTMLElement, label: string): HTMLButtonElement {
    return parent.createEl('button', { type: 'button', text: label });
  }
  private announce(message: string): void { this.announcement.textContent = message; }
  focus(): void { this.heading.focus({ preventScroll: true }); }

  private change(id: ActionId, control: 'toggle' | 'up' | 'down'): void {
    if (!this.store.canChangePreferences) return;
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
      row.up.disabled = !this.store.canChangePreferences || index <= 0;
      row.down.disabled = !this.store.canChangePreferences || index < 0 || index === view.pinned.length - 1;
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
      row.toggle.disabled = !this.store.canChangePreferences;
      row.up.disabled = !this.store.canChangePreferences || index <= 0;
      row.down.disabled = !this.store.canChangePreferences || index < 0 || index === pinned.length - 1;
    }
    this.reset.disabled = !this.store.canChangePreferences;
  }
}
