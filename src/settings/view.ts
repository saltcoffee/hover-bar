import type { Translate } from '../i18n';
import { BOOLEAN_KEYS, type BooleanPreferenceKey } from './model';
import { LayoutControls } from './layout-controls';
import type { PreferencesStore, StoreChange } from './store';

export interface StatusSectionHandle { refresh(): void }
export interface HistorySectionHandle { refresh(): void }

export function mountStatusSection(container: HTMLElement, store: PreferencesStore, t: Translate, focusFallback: () => void): StatusSectionHandle {
  let lastLoad = store.loadCount;
  const status = container.createEl('p', { cls: 'hover-bar-settings-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const recovery = container.createEl('p', { text: t('recovered') });
  const retry = container.createEl('button', { type: 'button' });
  retry.addEventListener('click', () => {
    if (store.status === 'saveError' || (store.status === 'ready' && store.unsavedPreferences)) void store.save();
    else void store.load();
  });
  const discard = container.createEl('p', { cls: 'hover-bar-reload-description', text: t('reloadDiscard') });
  return {
    refresh(): void {
      const retryable = (store.status !== 'ready' || store.unsavedPreferences) && !store.loading;
      if (!retryable && container.ownerDocument.activeElement === retry) focusFallback();
      retry.hidden = !retryable;
      retry.textContent = t(store.status === 'conflict' || store.status === 'schemaError' ? 'reload' : 'retry');
      retry.disabled = store.reading || store.saving || (store.enabled && !store.canChangePreferences);
      recovery.hidden = !store.recovered;
      const reloaded = store.loadCount !== lastLoad;
      lastLoad = store.loadCount;
      const key = store.loading ? 'loadingPreferences' : store.status === 'conflict' ? 'settingsConflict'
        : store.status !== 'ready' ? store.status : store.saving && store.unsavedPreferences ? 'saving'
        : store.unsavedPreferences ? 'preferencesPending' : reloaded ? 'reloaded' : 'saved';
      status.textContent = t(key);
      retry.setAttribute('aria-description', store.status === 'conflict' ? t('reloadDiscard') : '');
      discard.hidden = store.status !== 'conflict';
    },
  };
}

export function mountHistorySection(container: HTMLElement, store: PreferencesStore, t: Translate): HistorySectionHandle {
  const historyRoot = container.createEl('section', { cls: 'hover-bar-history-settings' });
  historyRoot.createEl('h3', { text: t('recentColors') });
  const historyStatus = historyRoot.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
  const historyRecovery = historyRoot.createEl('p', { text: t('historyRecovered') });
  historyRoot.createEl('p', { text: t('clearHistoryDesc') });
  const historyRetry = historyRoot.createEl('button', { type: 'button' });
  historyRetry.addEventListener('click', () => {
    if (store.historyStatus === 'conflict') void store.reloadHistory();
    else void store.save();
  });
  const historyClear = historyRoot.createEl('button', { type: 'button', text: t('clearHistory') });
  historyClear.addEventListener('click', () => { void store.clearColorHistory(); });
  return {
    refresh(): void {
      historyRecovery.hidden = !store.historyRecovered;
      historyClear.disabled = !store.canChangePreferences;
      const historyRetryable = store.historyStatus !== 'ready' || store.unsavedHistory;
      if (!historyRetryable && container.ownerDocument.activeElement === historyRetry) historyClear.focus({ preventScroll: true });
      historyRetry.hidden = !historyRetryable;
      historyRetry.textContent = t(store.historyStatus === 'conflict' ? 'reloadHistory' : 'retry');
      historyRetry.disabled = store.reading || store.saving || !store.enabled;
      historyRetry.setAttribute('aria-description', store.historyStatus === 'conflict' ? t('historyConflict') : '');
      historyStatus.textContent = t(store.historyLoading ? 'historyLoading' : store.historyStatus === 'conflict' ? 'historyConflict'
        : store.historyStatus === 'saveError' ? 'historySaveError' : store.saving && store.unsavedHistory ? 'historySaving'
        : store.unsavedHistory ? 'historySaveError' : 'historySaved');
    },
  };
}

export class PreferencesView {
  private readonly layout: LayoutControls;
  private readonly toggles = new Map<BooleanPreferenceKey, { readonly input: HTMLInputElement; readonly track: HTMLSpanElement }>();
  private readonly statusSection: StatusSectionHandle;
  private readonly historySection: HistorySectionHandle;
  private readonly reset: HTMLButtonElement;
  private readonly unsubscribe: () => void;

  constructor(private readonly root: HTMLElement, private readonly store: PreferencesStore, private readonly t: Translate) {
    root.classList.add('hover-bar-settings');
    this.statusSection = mountStatusSection(root, store, t, () => this.layout.focus());
    for (const key of BOOLEAN_KEYS) {
      const row = root.createDiv({ cls: 'setting-item mod-toggle' });
      const label = row.createEl('label', { cls: 'setting-item-info' });
      label.createDiv({ cls: 'setting-item-name', text: t(key) });
      label.createDiv({ cls: 'setting-item-description', text: t(`${key}Desc`) });
      const control = row.createDiv({ cls: 'setting-item-control' });
      const switchLabel = control.createEl('label', { cls: 'hover-bar-preference-switch' });
      const toggle = switchLabel.createEl('input', { type: 'checkbox', cls: 'hover-bar-preference-toggle', attr: { 'aria-label': t(key) } });
      toggle.id = `hover-bar-preference-${key}`; label.htmlFor = toggle.id;
      toggle.addEventListener('change', () => { void store.set(key, toggle.checked); });
      const track = switchLabel.createSpan({ cls: 'checkbox-container hover-bar-preference-track', attr: { 'aria-hidden': 'true' } });
      this.toggles.set(key, { input: toggle, track });
    }
    const layoutRoot = root.createEl('section');
    this.layout = new LayoutControls(layoutRoot, store, t);
    this.historySection = mountHistorySection(root, store, t);
    const resetRow = root.createDiv({ cls: 'setting-item hover-bar-reset-row' });
    const resetInfo = resetRow.createDiv({ cls: 'setting-item-info' });
    resetInfo.createDiv({ cls: 'setting-item-description', text: t('resetDesc') });
    const resetControl = resetRow.createDiv({ cls: 'setting-item-control' });
    this.reset = resetControl.createEl('button', { type: 'button', text: t('reset') });
    this.reset.addEventListener('click', () => { void store.reset(); });
    this.unsubscribe = store.subscribe(change => this.refresh(change));
    this.refresh({ kind: 'preferences', eligibilityChanged: true, layoutChanged: true });
  }

  private refresh(change: StoreChange): void {
    if (change.kind === 'preferences') {
      if (change.eligibilityChanged) for (const [key, entry] of this.toggles) entry.input.checked = this.store.value[key];
      if (change.layoutChanged) this.layout.update();
    }
    for (const { input, track } of this.toggles.values()) {
      input.disabled = !this.store.canChangePreferences;
      track.className = `checkbox-container hover-bar-preference-track${input.checked ? ' is-enabled' : ''}${input.disabled ? ' is-disabled' : ''}`;
    }
    this.layout.updateAvailability();
    this.reset.disabled = !this.store.canChangePreferences;
    this.statusSection.refresh();
    this.historySection.refresh();
  }

  destroy(): void { this.unsubscribe(); }
}
