import { Plugin, Notice, TFile, getLanguage } from 'obsidian';
import { ViewPlugin } from '@codemirror/view';
import { translator } from './i18n';
import { EditorController, type CloseReason, type Host } from './editor/controller';
import { revisionField } from './editor/context';
import { colorPreview } from './editor/color-preview';
import { NoteMetadata } from './editor/note-metadata';
import { PreferencesStore } from './settings/store';
import { HoverBarSettingsTab } from './settings/tab';

export default class HoverBarPlugin extends Plugin {
  private readonly controllers = new Set<EditorController>();
  private metadata!: NoteMetadata;
  private store!: PreferencesStore;
  private unloaded = false;
  private settingsTab: HoverBarSettingsTab | null = null;
  private historyNotice: Notice | null = null;
  private readonly t = translator(getLanguage);

  override async onload(): Promise<void> {
    this.store = new PreferencesStore({ load: () => this.loadData() as Promise<unknown>, save: value => this.saveData(value) });
    await this.store.load();
    if (this.unloaded) return;
    this.metadata = new NoteMetadata(this.app);
    const host: Host = { app: this.app, store: this.store, t: this.t, metadata: this.metadata, controllers: this.controllers, notify: message => { new Notice(message); } };
    this.registerEditorExtension([revisionField, colorPreview(host), ViewPlugin.define(view => new EditorController(view, host))]);
    this.settingsTab = new HoverBarSettingsTab(this.app, this, this.store, this.t);
    this.addSettingTab(this.settingsTab);
    let lastStatus = this.store.status;
    let historyWarned = false;
    let lastHistoryStatus = this.store.historyStatus;
    this.register(this.store.subscribe(change => {
      if (change.kind === 'preferences' || !this.store.enabled) this.closeAll('modeChanged');
      if (change.kind === 'preferences' && change.eligibilityChanged) this.app.workspace.updateOptions();
      if (change.kind === 'history') for (const controller of this.controllers) controller.refreshHistory();
      if (this.store.historyStatus === 'ready') {
        historyWarned = false; this.historyNotice?.hide(); this.historyNotice = null;
      } else if (!historyWarned) {
        historyWarned = true;
        this.historyNotice = new Notice(this.t(this.store.historyStatus === 'conflict' ? 'historyConflict' : 'historySaveError'), 0);
      } else if (lastHistoryStatus !== this.store.historyStatus) {
        this.historyNotice?.setMessage(this.t(this.store.historyStatus === 'conflict' ? 'historyConflict' : 'historySaveError'));
      }
      lastHistoryStatus = this.store.historyStatus;
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
      if (!this.store.canChangePreferences) { new Notice(this.t(this.store.enabled ? 'preferencesPaused' : this.store.status === 'conflict' ? 'settingsConflict' : this.store.status === 'schemaError' ? 'schemaError' : 'loadError')); return; }
      await this.store.set('automatic', !this.store.value.automatic);
      new Notice(this.t(this.store.value.automatic ? 'automaticOn' : 'automaticOff'));
    } });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.closeAll()));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      for (const controller of this.controllers) controller.reconcile();
    }));
    // Source-file identity loss ends the session; other target changes only invalidate candidates.
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      for (const controller of this.controllers) controller.handleExternalFileChange(oldPath, file.path);
      this.metadata.fileRenamed(oldPath, file.path);
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      for (const controller of this.controllers) controller.handleExternalFileChange(file.path);
      this.metadata.fileDeleted(file.path);
    }));
    // A folder can end in .md, but it will never receive a file indexing notification.
    this.registerEvent(this.app.vault.on('create', file => {
      if (file instanceof TFile) this.metadata.fileCreated(file.path);
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (file instanceof TFile) this.metadata.fileModified(file.path);
    }));
    // A metadata re-index confirms the file's latest content change; 'resolve'/'resolved' describe
    // link resolution rather than cache freshness and are intentionally not used here.
    this.registerEvent(this.app.metadataCache.on('changed', file => this.metadata.fileChanged(file.path)));
    this.registerEvent(this.app.metadataCache.on('deleted', file => this.metadata.fileDeleted(file.path)));
    if (!this.store.enabled) new Notice(this.t(this.store.status === 'schemaError' ? 'schemaError' : 'loadError'));
  }

  private closeAll(reason: CloseReason = 'outside'): void { for (const controller of this.controllers) controller.close(reason); }
  override async onExternalSettingsChange(): Promise<void> { if (this.store && !this.unloaded) await this.store.externalChange(); }
  override onunload(): void {
    this.unloaded = true; this.historyNotice?.hide(); this.settingsTab?.hide(); this.store?.destroy();
    for (const controller of [...this.controllers]) controller.destroy();
    this.metadata?.destroy();
  }
}
