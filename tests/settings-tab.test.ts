import { describe, expect, it, vi } from 'vitest';
import type { App, Plugin, Setting } from 'obsidian';
import { HoverBarSettingsTab } from '../src/settings/tab';
import { PreferencesView } from '../src/settings/view';
import { PreferencesStore } from '../src/settings/store';
import { encodeSettings } from '../src/settings/persistence';
import { BOOLEAN_KEYS, DEFAULTS } from '../src/settings/model';
import { translator } from '../src/i18n';
import { TestDocument, type TestElement } from './support/dom';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function setup(language = 'en', initial: unknown = null) {
  let disk: unknown = initial;
  let fail = false, failRead = false;
  const load = vi.fn(async () => { if (failRead) throw Error('read'); return disk; });
  const save = vi.fn(async (value: unknown) => { if (fail) throw Error('disk'); disk = value; });
  const store = new PreferencesStore({ load, save }); await store.load();
  const document = new TestDocument();
  const root = document.createElement('div'); document.body.append(root);
  const view = new PreferencesView(root as unknown as HTMLElement, store, translator(() => language));
  const row = (id: string) => root.querySelector(`[data-action="${id}"]`)!;
  const control = (id: string, name: string) => row(id).querySelector(`[data-control="${name}"]`)!;
  return { store, load, save, root, document, view, row, control, failReads: (value: boolean) => { failRead = value; }, failWrites: (value: boolean) => { fail = value; }, external: async (value: unknown) => { disk = value; await store.externalChange(); } };
}
const byText = (root: TestElement, text: string) => root.querySelectorAll('button').find(button => button.textContent === text)!;

describe('settings controls and live reload', () => {
  it.each(['en', 'zh'])('labels a failed preferences load as retry and retries the read in %s', async language => {
    const { store, load, save, root, view, failReads } = await setup(language);
    failReads(true); await store.load();
    const retry = root.querySelectorAll('button')[0]!;
    expect(store.status).toBe('loadError'); expect(retry.hidden).toBe(false);
    expect(retry.textContent).toBe(language === 'zh' ? '重试' : 'Retry'); expect(retry.disabled).toBe(false);
    failReads(false); load.mockClear(); retry.click(); await settle();
    expect(load).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled(); expect(store.status).toBe('ready'); view.destroy();
  });
  for (const language of ['en', 'zh']) {
    it.each(['schemaError', 'conflict'] as const)(`keeps an explicit reload action for %s in ${language}`, async status => {
      const { store, root, view, failWrites, external } = await setup(language, status === 'schemaError' ? { schemaVersion: 999 } : null);
      if (status === 'conflict') {
        failWrites(true); await store.set('automatic', false);
        await external(encodeSettings({ ...DEFAULTS, keyboard: true }));
      }
      expect(store.status).toBe(status);
      expect(root.querySelectorAll('button')[0]!.textContent).toBe(language === 'zh' ? '重新加载偏好' : 'Reload preferences');
      view.destroy();
    });
  }
  for (const language of ['en', 'zh']) {
    it.each([
      [['#ABC', '#aabbcc', '#112233'], ['#aabbcc', '#112233']],
      [['#aabbcc', 'red'], []],
    ])(`describes repaired history accurately in ${language}: %j`, async (input, expected) => {
      const { store, root, view } = await setup(language, { ...encodeSettings(DEFAULTS), colorHistory: { foreground: input, background: [] } });
      const recovery = root.querySelector('.hover-bar-history-settings')!.querySelectorAll('p')[1]!;
      expect(store.history.foreground).toEqual(expected); expect(recovery.hidden).toBe(false);
      expect(recovery.textContent).toBe(language === 'zh' ? '最近颜色记录已修复，笔记和偏好保持不变。' : 'Recent color history was repaired. Notes and preferences are unchanged.');
      view.destroy();
    });
  }
  it('reports history failures independently, retries without resetting preferences and clears only history', async () => {
    const fixture = await setup(); const { store, root, failWrites } = fixture;
    await store.set('automatic', false); failWrites(true); store.recordColorUse('foreground', '#aabbcc'); await settle();
    const history = root.querySelector('.hover-bar-history-settings')!;
    expect(history.textContent).toContain('Recent colors are not saved'); expect(root.querySelectorAll('input')[0]!.disabled).toBe(false);
    failWrites(false); byText(history, 'Retry').focus(); byText(history, 'Retry').click(); await settle();
    expect(store.history.foreground).toEqual(['#aabbcc']); expect(store.value.automatic).toBe(false);
    byText(root, 'Reset all preferences').click(); await settle(); expect(store.history.foreground).toEqual(['#aabbcc']);
    byText(history, 'Clear recent colors').click(); await settle(); expect(store.history.foreground).toEqual([]); expect(store.value).toEqual(DEFAULTS);
    fixture.view.destroy();
  });
  it('provides history reload during conflict while blocking switches, layout and clear controls', async () => {
    const fixture = await setup(); const { store, root, failWrites, external, control } = fixture;
    failWrites(true); store.recordColorUse('foreground', '#aabbcc'); await settle();
    await external({ ...encodeSettings(DEFAULTS), colorHistory: { foreground: ['#112233'], background: [] } });
    const history = root.querySelector('.hover-bar-history-settings')!;
    expect(root.querySelectorAll('input').every(input => input.disabled)).toBe(true);
    expect(control('bold', 'toggle').disabled).toBe(true); expect(byText(history, 'Clear recent colors').disabled).toBe(true);
    expect(byText(history, 'Reload recent colors').disabled).toBe(false); failWrites(false);
    byText(history, 'Reload recent colors').click(); await settle();
    expect(store.history.foreground).toEqual(['#112233']); expect(store.canChangePreferences).toBe(true);
    expect(root.querySelectorAll('input').every(input => !input.disabled)).toBe(true); fixture.view.destroy();
  });
  it('pins, moves and unpins with stable row focus, preserving focus when saving finishes', async () => {
    const fixture = await setup(); const { control, store, document, root } = fixture;
    control('clearColors', 'toggle').focus(); control('clearColors', 'toggle').click();
    expect(document.activeElement).toBe(control('clearColors', 'toggle'));
    expect(store.value.toolbar).toMatchObject({ kind: 'custom', pinned: expect.arrayContaining(['clearColors']) });
    control('clearColors', 'up').focus(); control('clearColors', 'up').click();
    expect(document.activeElement).toBe(control('clearColors', 'up'));
    await settle(); expect(document.activeElement).toBe(control('clearColors', 'up'));
    control('clearColors', 'toggle').click(); expect(control('clearColors', 'toggle').textContent).toBe('Pin');
    expect(document.activeElement).toBe(control('clearColors', 'toggle'));
    expect(root.textContent).toContain('moved to More'); fixture.view.destroy();
  });
  it('uses the fixed-state button when a move reaches the list boundary', async () => {
    const { control, store, document, view } = await setup();
    control('italic', 'up').focus(); control('italic', 'up').click();
    expect(control('italic', 'up').disabled).toBe(true); expect(document.activeElement).toBe(control('italic', 'toggle'));
    expect(store.value.toolbar).toMatchObject({ pinned: ['italic', 'bold', 'strike', 'code', 'highlight', 'foreground', 'background', 'link', 'chooseNote'] }); view.destroy();
  });
  it('updates visible switches and lists after external reload without writing, then edits the new order', async () => {
    const fixture = await setup(); const { root, external, save, control, row, store } = fixture;
    await external({ ...encodeSettings(DEFAULTS), automatic: false, keyboard: true, toolbar: { mode: 'custom', pinned: ['background', 'bold'] } });
    expect(root.querySelectorAll('input').map(input => input.checked)).toEqual([false, true, true, true]);
    expect(row('background').children[0]!.textContent).toBe('1. Background color');
    expect(row('italic').parentElement?.getAttribute('aria-label')).toBe('Unpinned');
    expect(save).not.toHaveBeenCalled();
    control('bold', 'up').click(); await settle();
    expect(store.value.toolbar).toEqual({ kind: 'custom', pinned: ['bold', 'background'] });
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ automatic: false, keyboard: true, toolbar: { mode: 'custom', pinned: ['bold', 'background'] } }));
    fixture.view.destroy();
  });
  it('keeps layout reset separate from full reset and disposes its subscription', async () => {
    const fixture = await setup(); const { store, root, control, view } = fixture;
    await store.set('automatic', false); control('highlight', 'toggle').click(); await settle();
    byText(root, 'Restore default layout').click(); await settle();
    expect(store.value.automatic).toBe(false); expect(store.value.toolbar.kind).toBe('default');
    byText(root, 'Reset all preferences').click(); await settle(); expect(store.value).toEqual(DEFAULTS);
    view.destroy(); await store.set('automatic', false); expect(root.querySelectorAll('input')[0]!.checked).toBe(true);
  });
});

describe('declarative settings tab adapter (Obsidian 1.13+)', () => {
  async function setupTab(language = 'en', initial: unknown = null) {
    let disk: unknown = initial;
    let fail = false;
    const load = vi.fn(async () => disk);
    const save = vi.fn(async (value: unknown) => { if (fail) throw Error('disk'); disk = value; });
    const store = new PreferencesStore({ load, save }); await store.load();
    const document = new TestDocument();
    const containerEl = document.createElement('div'); document.body.append(containerEl);
    const tab = new HoverBarSettingsTab({} as App, {} as Plugin, store, translator(() => language));
    tab.containerEl = containerEl as unknown as HTMLElement;
    const toggleValues = new Map<string, boolean>();
    const refreshDomState = vi.fn();
    const renderDeclarative = () => {
      containerEl.empty();
      const defs = tab.getSettingDefinitions();
      const renderedItems = defs.map(def => {
        const settingEl = containerEl.createDiv({ cls: 'setting-item' });
        const infoEl = settingEl.createDiv({ cls: 'setting-item-info' });
        const controlEl = settingEl.createDiv({ cls: 'setting-item-control' });
        const components: { getValue: () => boolean; setValue: (v: boolean) => void }[] = [];
        if (def.control) {
          const key = def.control.key;
          toggleValues.set(key, Boolean(tab.getControlValue(key)));
          components.push({
            getValue: () => toggleValues.get(key) ?? false,
            setValue: (v: boolean) => { toggleValues.set(key, v); },
          });
        }
        const setting = { settingEl, infoEl, controlEl, components } as unknown as Setting;
        def.render?.(setting);
        return { def, settingEl, setting };
      });
      Object.assign(tab, { renderedItems, refreshDomState });
      return defs;
    };
    return { tab, store, load, save, containerEl, toggleValues, refreshDomState, renderDeclarative, failWrites: (v: boolean) => { fail = v; }, external: async (v: unknown) => { disk = v; await store.externalChange(); } };
  }

  it.each(['en', 'zh'])('exposes localized declarative definitions without creating DOM during indexing in %s', async language => {
    const { tab, containerEl } = await setupTab(language);
    const defs = tab.getSettingDefinitions();
    expect(containerEl.children).toHaveLength(0);
    const toggles = defs.filter(def => def.control?.type === 'toggle');
    expect(toggles.map(def => def.control!.key)).toEqual([...BOOLEAN_KEYS]);
    expect(toggles.every(def => def.name.length > 0 && (def.desc?.length ?? 0) > 0)).toBe(true);
    const namedCustom = defs.filter(def => def.render && def.name.length > 0);
    expect(namedCustom).toHaveLength(3);
  });

  it('reads/writes through PreferencesStore, ignores unknown keys or disabled writes, and syncs on external changes & reset', async () => {
    const { tab, store, save, containerEl, toggleValues, refreshDomState, renderDeclarative, failWrites, external } = await setupTab();
    const defs = renderDeclarative();
    expect(tab.getControlValue('automatic')).toBe(true);
    expect(tab.getControlValue('unknownKey')).toBeUndefined();

    // Valid toggle produces exactly one persistence write
    await tab.setControlValue('automatic', false);
    expect(store.value.automatic).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    // Invalid key or non-boolean value does not write
    await tab.setControlValue('unknownKey', true);
    await tab.setControlValue('automatic', 'yes');
    expect(save).toHaveBeenCalledTimes(1);

    // Conflict disables all 4 declarative toggles and blocks writes
    failWrites(true);
    await tab.setControlValue('keyboard', true);
    await external(encodeSettings({ ...DEFAULTS, sourceMode: false }));
    expect(store.status).toBe('conflict');
    expect(defs.filter(def => def.control).every(def => def.disabled?.() === true)).toBe(true);
    const savesBeforeBlocked = save.mock.calls.length;
    await tab.setControlValue('livePreview', false);
    expect(save).toHaveBeenCalledTimes(savesBeforeBlocked);
    expect(store.value.livePreview).toBe(true);

    // Reloading from conflict restores writable state and updates toggle values to store values
    failWrites(false);
    await store.load();
    expect(store.status).toBe('ready');
    expect(store.canChangePreferences).toBe(true);
    expect(defs.filter(def => def.control).every(def => def.disabled?.() === false)).toBe(true);
    expect(toggleValues.get('sourceMode')).toBe(false);
    expect(refreshDomState).toHaveBeenCalled();

    // Reset button restores defaults and updates toggles
    byText(containerEl, 'Reset all preferences').click(); await settle();
    expect(store.value).toEqual(DEFAULTS);
    expect(toggleValues.get('sourceMode')).toBe(true);

    // hide() unsubscribes from store updates
    refreshDomState.mockClear();
    tab.hide();
    await store.set('automatic', false);
    expect(refreshDomState).not.toHaveBeenCalled();
  });

  it('still renders the complete legacy view via display() and cleans up on hide()', async () => {
    const { tab, store, containerEl } = await setupTab();
    tab.display();
    expect(containerEl.querySelectorAll('input')).toHaveLength(4);
    expect(containerEl.querySelectorAll('.hover-bar-preference-track')).toHaveLength(4);
    tab.hide();
    await store.set('automatic', false);
    expect(containerEl.querySelectorAll('input')[0]!.checked).toBe(true);
  });

  it('falls back to renderTab when eligibility changes and renderedItems is unavailable, without interrupting layout edits', async () => {
    const { tab, store, renderDeclarative } = await setupTab();
    renderDeclarative();
    const renderTab = vi.fn();
    Object.assign(tab, { renderedItems: undefined, renderTab });
    await store.setLayout({ kind: 'custom', pinned: ['bold'] });
    expect(renderTab).not.toHaveBeenCalled();
    await store.set('automatic', false);
    expect(renderTab).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it('tears down a prior legacy view when declarative rendering mounts without an intervening hide()', async () => {
    const { tab, store, containerEl, renderDeclarative } = await setupTab();
    tab.display();
    const legacyInput = containerEl.querySelectorAll('input')[0]!;
    expect(legacyInput.checked).toBe(true);
    renderDeclarative();
    await store.set('automatic', false);
    expect(legacyInput.checked).toBe(true);
    tab.hide();
  });
});
