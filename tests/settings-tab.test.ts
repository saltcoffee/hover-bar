import { describe, expect, it, vi } from 'vitest';
import { PreferencesView } from '../src/settings/view';
import { PreferencesStore } from '../src/settings/store';
import { encodeSettings } from '../src/settings/persistence';
import { DEFAULTS } from '../src/settings/model';
import { translator } from '../src/i18n';
import { TestDocument, type TestElement } from './support/dom';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function setup() {
  let disk: unknown = null;
  const save = vi.fn(async (value: unknown) => { disk = value; });
  const store = new PreferencesStore({ load: async () => disk, save }); await store.load();
  const document = new TestDocument();
  const root = document.createElement('div'); document.body.append(root);
  const view = new PreferencesView(root as unknown as HTMLElement, store, translator(() => 'en'));
  const row = (id: string) => root.querySelector(`[data-action="${id}"]`)!;
  const control = (id: string, name: string) => row(id).querySelector(`[data-control="${name}"]`)!;
  return { store, save, root, document, view, row, control, external: async (value: unknown) => { disk = value; await store.externalChange(); } };
}
const byText = (root: TestElement, text: string) => root.querySelectorAll('button').find(button => button.textContent === text)!;

describe('settings controls and live reload', () => {
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
