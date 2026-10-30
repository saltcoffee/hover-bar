import type { Translate } from '../i18n';
import { BOOLEAN_KEYS, type BooleanPreferenceKey } from './model';
import { LayoutControls } from './layout-controls';
import type { PreferencesStore, StoreChange } from './store';

export class PreferencesView {
  private readonly layout: LayoutControls;
  private readonly toggles = new Map<BooleanPreferenceKey, HTMLInputElement>();
  private readonly status: HTMLParagraphElement;
  private readonly recovery: HTMLParagraphElement;
  private readonly retry: HTMLButtonElement;
  private readonly reset: HTMLButtonElement;
  private readonly unsubscribe: () => void;
  private lastLoad: number;

  constructor(private readonly root: HTMLElement, private readonly store: PreferencesStore, private readonly t: Translate) {
    const doc = root.ownerDocument;
    root.classList.add('hover-bar-settings');
    this.lastLoad = store.loadCount;
    this.status = doc.createElement('p'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.recovery = doc.createElement('p'); this.recovery.textContent = t('recovered');
    this.retry = doc.createElement('button'); this.retry.type = 'button';
    this.retry.addEventListener('click', () => { if (store.status === 'saveError') void store.save(); else void store.load(); });
    root.append(this.status, this.recovery, this.retry);
    for (const key of BOOLEAN_KEYS) {
      const row = doc.createElement('div'); row.className = 'setting-item';
      const label = doc.createElement('label'); label.className = 'setting-item-info';
      const name = doc.createElement('div'); name.className = 'setting-item-name'; name.textContent = t(key);
      const description = doc.createElement('div'); description.className = 'setting-item-description'; description.textContent = t(`${key}Desc`);
      const toggle = doc.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'hover-bar-preference-toggle';
      toggle.setAttribute('aria-label', t(key)); toggle.addEventListener('change', () => { void store.set(key, toggle.checked); });
      label.append(name, description, toggle); row.append(label); root.append(row); this.toggles.set(key, toggle);
    }
    const layoutRoot = doc.createElement('section'); root.append(layoutRoot);
    this.layout = new LayoutControls(layoutRoot, store, t);
    const resetRow = doc.createElement('div'); resetRow.className = 'setting-item';
    const resetDescription = doc.createElement('div'); resetDescription.className = 'setting-item-description'; resetDescription.textContent = t('resetDesc');
    this.reset = doc.createElement('button'); this.reset.type = 'button'; this.reset.textContent = t('reset');
    this.reset.addEventListener('click', () => { void store.reset(); });
    resetRow.append(resetDescription, this.reset); root.append(resetRow);
    this.unsubscribe = store.subscribe(change => this.refresh(change));
    this.refresh({ kind: 'preferences', eligibilityChanged: true, layoutChanged: true });
  }

  private refresh(change: StoreChange): void {
    if (change.kind === 'preferences') {
      if (change.eligibilityChanged) for (const [key, toggle] of this.toggles) toggle.checked = this.store.value[key];
      if (change.layoutChanged) this.layout.update();
    }
    for (const toggle of this.toggles.values()) toggle.disabled = !this.store.enabled;
    this.layout.updateAvailability(); this.reset.disabled = !this.store.enabled;
    const retryable = this.store.status !== 'ready' && !this.store.loading;
    if (!retryable && this.root.ownerDocument.activeElement === this.retry) this.layout.focus();
    this.retry.hidden = !retryable;
    this.retry.textContent = this.t(this.store.status === 'saveError' ? 'retry' : 'reload');
    this.retry.disabled = this.store.loading || this.store.saving;
    this.recovery.hidden = !this.store.recovered;
    const reloaded = this.store.loadCount !== this.lastLoad;
    this.lastLoad = this.store.loadCount;
    const key = this.store.loading ? 'loadingPreferences' : this.store.status === 'conflict' ? 'settingsConflict'
      : this.store.status !== 'ready' ? this.store.status : this.store.saving ? 'saving' : reloaded ? 'reloaded' : 'saved';
    this.status.textContent = this.t(key);
    this.retry.setAttribute('aria-description', this.store.status === 'conflict' ? this.t('reloadDiscard') : '');
    let discard = this.root.querySelector<HTMLParagraphElement>('.hover-bar-reload-description');
    if (!discard) { discard = this.root.ownerDocument.createElement('p'); discard.className = 'hover-bar-reload-description'; this.retry.after(discard); }
    discard.textContent = this.t('reloadDiscard'); discard.hidden = this.store.status !== 'conflict';
  }

  destroy(): void { this.unsubscribe(); }
}
