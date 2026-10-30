import { Plugin, Notice, getLanguage } from 'obsidian';
import { ViewPlugin } from '@codemirror/view';
import { translator } from './i18n';
import { EditorController, type CloseReason, type Host } from './editor/controller';
import { revisionField } from './editor/context';
import { colorPreview } from './editor/color-preview';
import { PreferencesStore } from './settings/store';
import { HoverBarSettingsTab } from './settings/tab';

export default class HoverBarPlugin extends Plugin {
  private readonly controllers = new Set<EditorController>();
  private store!: PreferencesStore;
  private unloaded = false;
  private settingsTab: HoverBarSettingsTab | null = null;
  private readonly t = translator(getLanguage);

  override async onload(): Promise<void> {
    this.store = new PreferencesStore({ load: () => this.loadData() as Promise<unknown>, save: value => this.saveData(value) });
    await this.store.load();
    if (this.unloaded) return;
    const host: Host = { app: this.app, store: this.store, t: this.t, controllers: this.controllers, notify: message => { new Notice(message); } };
    this.registerEditorExtension([revisionField, colorPreview(host), ViewPlugin.define(view => new EditorController(view, host))]);
    this.settingsTab = new HoverBarSettingsTab(this.app, this, this.store, this.t);
    this.addSettingTab(this.settingsTab);
    let lastStatus = this.store.status;
    this.register(this.store.subscribe(change => {
      if (change.kind === 'preferences' || !this.store.enabled) this.closeAll('modeChanged');
      if (change.kind === 'preferences' && change.eligibilityChanged) this.app.workspace.updateOptions();
      if (lastStatus !== this.store.status && this.store.status !== 'ready') {
        new Notice(this.t(this.store.status === 'conflict' ? 'settingsConflict' : this.store.status));
      }
      lastStatus = this.store.status;
    }));
    this.addCommand({ id: 'show-selection-toolbar', name: this.t('showToolbar'), editorCallback: editor => {
      const controller = [...this.controllers].find(candidate => candidate.matchesEditor(editor));
      if (!controller) new Notice(this.t('noSelection')); else controller.show(true);
    } });
    this.addCommand({ id: 'toggle-automatic-toolbar', name: this.t('toggleAutomatic'), callback: async () => {
      if (!this.store.enabled) { new Notice(this.t(this.store.status === 'conflict' ? 'settingsConflict' : this.store.status === 'schemaError' ? 'schemaError' : 'loadError')); return; }
      await this.store.set('automatic', !this.store.value.automatic);
      new Notice(this.t(this.store.value.automatic ? 'automaticOn' : 'automaticOff'));
    } });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.closeAll()));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      for (const controller of this.controllers) controller.reconcile();
    }));
    this.registerEvent(this.app.vault.on('rename', () => this.closeAll('stale')));
    this.registerEvent(this.app.vault.on('delete', () => this.closeAll('stale')));
    if (!this.store.enabled) new Notice(this.t(this.store.status === 'schemaError' ? 'schemaError' : 'loadError'));
  }

  private closeAll(reason: CloseReason = 'outside'): void { for (const controller of this.controllers) controller.close(reason); }
  override async onExternalSettingsChange(): Promise<void> { if (this.store && !this.unloaded) await this.store.externalChange(); }
  override onunload(): void { this.unloaded = true; this.settingsTab?.hide(); this.store?.destroy(); for (const controller of [...this.controllers]) controller.destroy(); }
}
