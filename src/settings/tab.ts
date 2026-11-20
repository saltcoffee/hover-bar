import { PluginSettingTab, type App, type Plugin, type Setting } from 'obsidian';
import type { Translate } from '../i18n';
import { BOOLEAN_KEYS, type BooleanPreferenceKey } from './model';
import { LayoutControls } from './layout-controls';
import type { PreferencesStore, StoreChange } from './store';
import { PreferencesView, mountHistorySection, mountStatusSection, type HistorySectionHandle, type StatusSectionHandle } from './view';

/** Minimal Obsidian 1.13+ declarative settings boundary kept local while SDK targets 1.8.7. */
export interface DeclarativeToggleControl {
  readonly type: 'toggle';
  readonly key: BooleanPreferenceKey;
}

export interface SettingDefinition {
  readonly name: string;
  readonly desc?: string;
  readonly disabled?: () => boolean;
  readonly control?: DeclarativeToggleControl;
  readonly render?: (setting: Setting) => void;
}

interface HostDeclarativeTab {
  refreshDomState?: () => void;
  renderTab?: () => void;
  renderedItems?: readonly unknown[];
}

interface ToggleComponentLike {
  getValue?: () => unknown;
  setValue?: (value: boolean) => unknown;
}

interface RenderedEntryLike {
  readonly children?: readonly unknown[];
  readonly def?: { readonly control?: { readonly key?: unknown } };
  readonly setting?: { readonly components?: readonly unknown[] };
}

function isBooleanKey(key: string): key is BooleanPreferenceKey {
  return (BOOLEAN_KEYS as readonly string[]).includes(key);
}

export class HoverBarSettingsTab extends PluginSettingTab {
  private view: PreferencesView | null = null;
  private declarativeUnsubscribe: (() => void) | null = null;
  private declarativeStatus: StatusSectionHandle | null = null;
  private declarativeLayout: LayoutControls | null = null;
  private declarativeHistory: HistorySectionHandle | null = null;
  private declarativeReset: HTMLButtonElement | null = null;

  constructor(app: App, plugin: Plugin, private readonly store: PreferencesStore, private readonly t: Translate) {
    super(app, plugin);
  }

  /** Declarative setting definitions indexed and rendered by Obsidian 1.13+. */
  getSettingDefinitions(): SettingDefinition[] {
    return [
      {
        name: '',
        render: setting => {
          this.ensureDeclarativeLifecycle();
          setting.settingEl.classList.add('hover-bar-status-row');
          setting.infoEl.hidden = true;
          setting.controlEl.hidden = true;
          this.declarativeStatus = mountStatusSection(setting.settingEl, this.store, this.t, () => this.declarativeLayout?.focus());
          this.declarativeStatus.refresh();
        },
      },
      ...BOOLEAN_KEYS.map((key): SettingDefinition => ({
        name: this.t(key),
        desc: this.t(`${key}Desc`),
        disabled: () => !this.store.canChangePreferences,
        control: { type: 'toggle', key },
      })),
      {
        name: this.t('layout'),
        desc: this.t('layoutDesc'),
        render: setting => {
          this.ensureDeclarativeLifecycle();
          setting.settingEl.classList.add('hover-bar-block-row');
          setting.infoEl.hidden = true;
          setting.controlEl.hidden = true;
          const layoutRoot = setting.settingEl.createEl('section');
          this.declarativeLayout = new LayoutControls(layoutRoot, this.store, this.t);
          this.declarativeLayout.updateAvailability();
        },
      },
      {
        name: this.t('recentColors'),
        desc: this.t('clearHistoryDesc'),
        render: setting => {
          this.ensureDeclarativeLifecycle();
          setting.settingEl.classList.add('hover-bar-block-row');
          setting.infoEl.hidden = true;
          setting.controlEl.hidden = true;
          this.declarativeHistory = mountHistorySection(setting.settingEl, this.store, this.t);
          this.declarativeHistory.refresh();
        },
      },
      {
        name: this.t('reset'),
        desc: this.t('resetDesc'),
        render: setting => {
          this.ensureDeclarativeLifecycle();
          setting.settingEl.classList.add('hover-bar-reset-row');
          const button = setting.controlEl.createEl('button', { type: 'button', text: this.t('reset') });
          button.addEventListener('click', () => { void this.store.reset(); });
          this.declarativeReset = button;
          button.disabled = !this.store.canChangePreferences;
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return isBooleanKey(key) ? this.store.value[key] : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!isBooleanKey(key) || typeof value !== 'boolean' || !this.store.canChangePreferences) {
      this.syncDeclarativeToggles();
      return;
    }
    await this.store.set(key, value);
  }

  /** Legacy fallback path used by Obsidian 1.8.7–1.12.x. */
  override display(): void {
    this.hide(); this.containerEl.empty();
    this.view = new PreferencesView(this.containerEl, this.store, this.t);
  }

  override hide(): void {
    this.view?.destroy(); this.view = null;
    this.declarativeUnsubscribe?.(); this.declarativeUnsubscribe = null;
    this.declarativeStatus = null;
    this.declarativeLayout = null;
    this.declarativeHistory = null;
    this.declarativeReset = null;
  }

  private ensureDeclarativeLifecycle(): void {
    this.view?.destroy(); this.view = null;
    this.containerEl.classList.add('hover-bar-settings');
    if (this.declarativeUnsubscribe) return;
    this.declarativeUnsubscribe = this.store.subscribe(change => this.syncDeclarative(change));
  }

  private syncDeclarative(change: StoreChange): void {
    if (change.kind === 'preferences' && change.layoutChanged) this.declarativeLayout?.update();
    this.declarativeLayout?.updateAvailability();
    if (this.declarativeReset) this.declarativeReset.disabled = !this.store.canChangePreferences;
    this.declarativeStatus?.refresh();
    this.declarativeHistory?.refresh();
    this.syncDeclarativeToggles(change.kind === 'preferences' && change.eligibilityChanged);
  }

  private syncDeclarativeToggles(eligibilityChanged = false): void {
    const host = this as unknown as HostDeclarativeTab;
    let synced = 0;
    if (Array.isArray(host.renderedItems)) {
      const visit = (items: readonly unknown[]): void => {
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const entry = item as RenderedEntryLike;
          if (Array.isArray(entry.children)) visit(entry.children);
          const key = entry.def?.control?.key;
          if (typeof key !== 'string' || !isBooleanKey(key)) continue;
          const component = entry.setting?.components?.[0] as ToggleComponentLike | undefined;
          if (!component || typeof component.setValue !== 'function') continue;
          synced++;
          const expected = this.store.value[key];
          if (component.getValue?.() !== expected) component.setValue(expected);
        }
      };
      visit(host.renderedItems);
    }
    if (eligibilityChanged && synced < BOOLEAN_KEYS.length && typeof host.renderTab === 'function') {
      host.renderTab();
      return;
    }
    host.refreshDomState?.();
  }
}
