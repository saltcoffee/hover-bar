import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { Translate, TextKey } from '../i18n';
import type { PreferenceKey } from './model';
import type { PreferencesStore } from './store';

export class HoverBarSettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly store: PreferencesStore, private readonly t: Translate) { super(app, plugin); }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const stateKey = this.store.status === 'conflict' ? 'settingsConflict' : this.store.status;
    if (stateKey !== 'ready') {
      new Setting(containerEl).setName(this.t(stateKey)).addButton(button => button
        .setButtonText(this.t(this.store.status === 'saveError' ? 'retry' : 'reload'))
        .onClick(async () => {
          if (this.store.status === 'saveError') await this.store.save(); else await this.store.load();
          this.display();
        }));
    } else if (this.store.recovered) new Setting(containerEl).setName(this.t('recovered'));
    for (const key of ['automatic', 'livePreview', 'sourceMode', 'keyboard'] as const satisfies readonly PreferenceKey[]) {
      new Setting(containerEl).setName(this.t(key)).setDesc(this.t(`${key}Desc` as TextKey))
        .addToggle(toggle => toggle.setValue(this.store.value[key]).setDisabled(!this.store.enabled)
          .onChange(async value => { await this.store.set(key, value); this.display(); }));
    }
    new Setting(containerEl).setName(this.t('reset')).setDesc(this.t('resetDesc'))
      .addButton(button => button.setButtonText(this.t('reset')).setDisabled(!this.store.enabled)
        .onClick(async () => { await this.store.reset(); this.display(); }));
  }
}
