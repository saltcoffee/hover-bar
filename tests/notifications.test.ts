import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import HoverBarPlugin from '../src/main';
import { DEFAULTS } from '../src/settings/model';
import { encodeSettings } from '../src/settings/persistence';
import { stringsFor } from '../src/i18n';
import type { EditorController } from '../src/editor/controller';

const fixture = vi.hoisted(() => ({ disk: null as unknown, language: 'en', fail: true,
  notices: [] as { message: string; hidden: boolean; setMessage(message: string): unknown; hide(): void }[] }));

vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<typeof import('obsidian')>(),
  getLanguage: () => fixture.language,
  setIcon: vi.fn(),
  Notice: class {
    hidden = false;
    setMessage = vi.fn((message: string) => { this.message = message; return this; });
    hide = vi.fn(() => { this.hidden = true; });
    constructor(public message: string) { fixture.notices.push(this); }
  },
  Plugin: class {
    constructor(readonly app: App) {}
    loadData() { return Promise.resolve(fixture.disk); }
    async saveData(value: unknown) { if (fixture.fail) throw Error('disk'); fixture.disk = value; }
    register() {} registerEvent() {} registerEditorExtension() {} addSettingTab() {} addCommand() {}
  },
  PluginSettingTab: class {},
}));

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => { fixture.disk = encodeSettings(DEFAULTS); fixture.fail = true; fixture.notices = []; fixture.language = 'en'; });

async function setup(language: string) {
  fixture.language = language;
  const app = { workspace: { on: vi.fn(), updateOptions: vi.fn() }, vault: { on: vi.fn() } } as unknown as App;
  const plugin = new HoverBarPlugin(app, {} as PluginManifest); await plugin.onload();
  return plugin;
}

describe('history save and conflict notifications', () => {
  it('does not close a newer controller when an older history save completes', async () => {
    const plugin = await setup('en'), store = plugin['store'];
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    vi.spyOn(store['persistence'], 'save').mockImplementationOnce(() => pending);
    const old = { refreshHistory: vi.fn(), close: vi.fn(), destroy: vi.fn() } as unknown as EditorController;
    const current = { refreshHistory: vi.fn(), close: vi.fn(), destroy: vi.fn() } as unknown as EditorController;
    try {
      plugin['controllers'].add(old); store.recordColorUse('foreground', '#aabbcc'); await settle();
      expect(old.refreshHistory).toHaveBeenCalledTimes(1); expect(store.saving).toBe(true);
      plugin['controllers'].delete(old); plugin['controllers'].add(current); resolve(); await settle();
      expect(store.historyStatus).toBe('ready'); expect(store.unsavedHistory).toBe(false);
      expect(current.close).not.toHaveBeenCalled(); expect(current.refreshHistory).not.toHaveBeenCalled();
    } finally { resolve(); plugin.onunload(); }
  });
  it('keeps controllers active without history refreshes for save failures and conflict status changes', async () => {
    const plugin = await setup('en'), store = plugin['store'];
    const controller = { refreshHistory: vi.fn(), close: vi.fn(), destroy: vi.fn() } as unknown as EditorController;
    try {
      plugin['controllers'].add(controller); store.recordColorUse('foreground', '#aabbcc'); await settle();
      expect(store.historyStatus).toBe('saveError'); expect(controller.refreshHistory).toHaveBeenCalledTimes(1);
      vi.mocked(controller.refreshHistory).mockClear(); await store.save();
      fixture.disk = encodeSettings(DEFAULTS, { foreground: ['#112233'], background: [] }); await store.externalChange();
      expect(store.historyStatus).toBe('conflict'); expect(controller.close).not.toHaveBeenCalled();
      expect(controller.refreshHistory).not.toHaveBeenCalled();
    } finally { plugin.onunload(); }
  });
  it.each(['en', 'zh'])('updates the same %s notice when a save failure becomes an external conflict', async language => {
    const plugin = await setup(language), store = plugin['store'];
    try {
      store.recordColorUse('foreground', '#aabbcc'); await settle();
      expect(fixture.notices).toHaveLength(1); const notice = fixture.notices[0]!;
      expect(notice.message).toBe(stringsFor(language).historySaveError);
      store.recordColorUse('foreground', '#445566'); await settle(); expect(fixture.notices).toHaveLength(1);
      fixture.disk = encodeSettings(DEFAULTS, { foreground: ['#112233'], background: [] }); await plugin.onExternalSettingsChange();
      expect(store.historyStatus).toBe('conflict'); expect(fixture.notices).toHaveLength(1);
      expect(notice.message).toBe(stringsFor(language).historyConflict);
      expect(notice.setMessage).toHaveBeenCalledExactlyOnceWith(stringsFor(language).historyConflict);
      await store.externalChange(); expect(notice.setMessage).toHaveBeenCalledTimes(1);
      await store.reloadHistory(); expect(notice.hide).toHaveBeenCalled();
      store.recordColorUse('foreground', '#aabbcc'); await settle(); expect(fixture.notices).toHaveLength(2);
    } finally { plugin.onunload(); }
  });
  it('keeps a dismissed notice dismissed across a conflict transition', async () => {
    const plugin = await setup('en'), store = plugin['store'];
    try {
      store.recordColorUse('foreground', '#aabbcc'); await settle(); const notice = fixture.notices[0]!; notice.hide();
      fixture.disk = encodeSettings(DEFAULTS, { foreground: ['#112233'], background: [] }); await store.externalChange();
      expect(notice.hidden).toBe(true); expect(fixture.notices).toHaveLength(1);
    } finally { plugin.onunload(); }
  });
});
