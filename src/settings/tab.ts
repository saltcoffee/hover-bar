import { PluginSettingTab, type App, type Plugin } from 'obsidian';
import type { Translate } from '../i18n';
import type { PreferencesStore } from './store';
import { PreferencesView } from './view';

export class HoverBarSettingsTab extends PluginSettingTab {
  private view: PreferencesView | null = null;
  constructor(app: App, plugin: Plugin, private readonly store: PreferencesStore, private readonly t: Translate) { super(app, plugin); }

  override display(): void {
    this.hide(); this.containerEl.empty();
    this.view = new PreferencesView(this.containerEl, this.store, this.t);
  }

  override hide(): void { this.view?.destroy(); this.view = null; }
}
