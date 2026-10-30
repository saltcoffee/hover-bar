import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/settings/model';
import { decodeSettings, encodeSettings, UnsupportedSchemaError } from '../src/settings/persistence';
import { PreferencesStore } from '../src/settings/store';
import { stringsFor, translator } from '../src/i18n';
import { place, viewportBounds } from '../src/ui/position';

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const custom = (pinned: unknown) => ({ ...encodeSettings(DEFAULTS), toolbar: { mode: 'custom', pinned } });

describe('preferences codec', () => {
  it('loads first-run defaults and migrates valid legacy switches without saving', () => {
    expect(decodeSettings(null)).toEqual({ value: DEFAULTS, migrated: false, recovered: false });
    const result = decodeSettings({ schemaVersion: 1, automatic: false, livePreview: false, sourceMode: true, keyboard: true });
    expect(result).toEqual({ value: { automatic: false, livePreview: false, sourceMode: true, keyboard: true, toolbar: { kind: 'default' } }, migrated: true, recovered: false });
    expect(result.value).not.toHaveProperty('schemaVersion');
  });
  it('separates recovery from migration and preserves unrelated valid values', () => {
    const result = decodeSettings({ automatic: false, keyboard: 'yes' });
    expect(result).toMatchObject({ migrated: true, recovered: true, value: { automatic: false, keyboard: false } });
    expect(decodeSettings({ schemaVersion: 1, automatic: 'yes' }).value.automatic).toBe(true);
    expect(decodeSettings([])).toMatchObject({ value: DEFAULTS, recovered: true });
    expect(decodeSettings({ ...encodeSettings(DEFAULTS), keyboard: undefined })).toMatchObject({ recovered: true });
  });
  it.each([3, 99, '2', null, 0, -1, 1.5, undefined])('rejects an explicit unsupported version %s', schemaVersion => {
    expect(() => decodeSettings({ schemaVersion })).toThrow(UnsupportedSchemaError);
  });
  it('preserves custom order while removing duplicates and invalid IDs', () => {
    expect(decodeSettings(custom(['highlight', 'unknown', 'bold', 'highlight', 2]))).toMatchObject({ recovered: true, value: { toolbar: { kind: 'custom', pinned: ['highlight', 'bold'] } } });
    expect(decodeSettings(custom([]))).toMatchObject({ recovered: false, value: { toolbar: { kind: 'custom', pinned: [] } } });
    expect(decodeSettings(custom(['unknown']))).toMatchObject({ recovered: true, value: { toolbar: { kind: 'default' } } });
  });
  it.each([undefined, null, [], { mode: 'custom', pinned: 'bold' }, { mode: 'other', pinned: [] }, { mode: 'default', pinned: [] }])('recovers a malformed layout: %s', toolbar => {
    const value = { ...encodeSettings(DEFAULTS), automatic: false, toolbar };
    expect(decodeSettings(value)).toMatchObject({ recovered: true, value: { automatic: false, toolbar: { kind: 'default' } } });
  });
  it('keeps default and identically ordered custom layouts distinct across a round trip', () => {
    const stored = encodeSettings(DEFAULTS);
    expect(decodeSettings(stored)).toMatchObject({ migrated: false, recovered: false, value: DEFAULTS });
    const sameOrder = decodeSettings(custom(stored.toolbar.pinned));
    expect(sameOrder.value.toolbar.kind).toBe('custom');
    expect(encodeSettings(sameOrder.value).toolbar.mode).toBe('custom');
  });
  it('copies and freezes memory values and independently encodes arrays', () => {
    const input = custom(['highlight', 'bold']);
    const parsed = decodeSettings(input).value;
    (input.toolbar.pinned as string[]).push('strike');
    expect(parsed.toolbar).toEqual({ kind: 'custom', pinned: ['highlight', 'bold'] });
    const first = encodeSettings(parsed), second = encodeSettings(parsed);
    expect(first.toolbar.pinned).not.toBe(second.toolbar.pinned);
    expect(Object.isFrozen(parsed.toolbar.kind === 'custom' && parsed.toolbar.pinned)).toBe(true);
    expect(() => encodeSettings({ ...DEFAULTS, toolbar: { kind: 'custom', pinned: ['more' as 'bold'] } })).toThrow();
  });
});

describe('preferences persistence and notifications', () => {
  it('does not write on load, but explicitly restores migrated or recovered equal defaults', async () => {
    for (const raw of [{ schemaVersion: 1 }, custom(['unknown'])]) {
      const save = vi.fn(async () => {});
      const store = new PreferencesStore({ load: async () => raw, save });
      await store.load(); expect(save).not.toHaveBeenCalled(); expect(store.needsWriteback).toBe(true);
      const listener = vi.fn(); store.subscribe(listener);
      await store.resetLayout(); expect(save).toHaveBeenCalledExactlyOnceWith(encodeSettings(DEFAULTS));
      expect(store.needsWriteback).toBe(false); expect(store.recovered).toBe(false);
      expect(listener.mock.calls.every(([change]) => change.kind === 'status')).toBe(true);
      await store.reset(); expect(save).toHaveBeenCalledTimes(1);
    }
  });
  it('restores only the layout, and a full reset also restores switches', async () => {
    const store = new PreferencesStore({ load: async () => custom(['highlight']), save: async () => {} });
    await store.load(); await store.set('automatic', false); await store.resetLayout();
    expect(store.value).toMatchObject({ automatic: false, toolbar: { kind: 'default' } });
    await store.reset(); expect(store.value).toEqual(DEFAULTS);
  });
  it('retains active memory and recovery flags after failure, then retries the latest snapshot', async () => {
    const writes: unknown[] = []; let fail = true;
    const store = new PreferencesStore({ load: async () => custom(['unknown']), save: async dto => { writes.push(dto); if (fail) throw Error('disk'); } });
    await store.load(); await store.resetLayout();
    expect(store.enabled).toBe(true); expect(store.status).toBe('saveError'); expect(store.needsWriteback).toBe(true); expect(store.recovered).toBe(true);
    await store.setLayout({ kind: 'custom', pinned: ['clearColors', 'highlight'] });
    fail = false; await store.save();
    expect(writes.at(-1)).toMatchObject({ toolbar: { mode: 'custom', pinned: ['clearColors', 'highlight'] } });
    expect(store.status).toBe('ready'); expect(store.recovered).toBe(false); expect(store.needsWriteback).toBe(false);
  });
  it('serializes independent immutable snapshots and does not clear newer work on old completion', async () => {
    const first = deferred(), second = deferred(); const values: unknown[] = [];
    const store = new PreferencesStore({ load: async () => null, save: dto => { values.push(dto); return values.length === 1 ? first.promise : second.promise; } });
    await store.load();
    const r1 = store.setLayout({ kind: 'custom', pinned: ['highlight'] });
    const r2 = store.setLayout({ kind: 'custom', pinned: ['highlight', 'bold'] });
    await settle(); expect(values).toHaveLength(1); expect(store.saving).toBe(true);
    first.resolve(); await settle(); expect(values).toHaveLength(2); expect(store.saving).toBe(true);
    expect(values[0]).toMatchObject({ toolbar: { pinned: ['highlight'] } });
    second.reject(Error('disk')); await Promise.all([r1, r2]);
    expect(store.status).toBe('saveError'); expect(store.value.toolbar).toEqual({ kind: 'custom', pinned: ['highlight', 'bold'] });
  });
  it('deduplicates same-revision restores and retries already in flight', async () => {
    const request = deferred(); const save = vi.fn(() => request.promise);
    const store = new PreferencesStore({ load: async () => ({ schemaVersion: 1 }), save });
    await store.load(); const first = store.resetLayout(), second = store.reset(), third = store.save();
    await settle(); expect(save).toHaveBeenCalledTimes(1); request.resolve();
    await Promise.all([first, second, third]); expect(store.saving).toBe(false); expect(store.status).toBe('ready');
  });
  it.each(['queued', 'writing', 'failed'] as const)('stops subsequent writes after an external conflict while %s', async phase => {
    const request = deferred(); const save = vi.fn(() => phase === 'failed' ? Promise.reject(Error('disk')) : request.promise);
    let disk: unknown = null;
    const store = new PreferencesStore({ load: async () => disk, save });
    await store.load(); const first = store.set('automatic', false), second = store.set('keyboard', true);
    if (phase !== 'queued') await settle();
    if (phase === 'failed') await Promise.all([first, second]);
    disk = custom(['background']); await store.externalChange();
    expect(store.status).toBe('conflict'); expect(store.enabled).toBe(false);
    const before = save.mock.calls.length;
    await store.reset(); await store.set('automatic', true); await store.save();
    expect(save).toHaveBeenCalledTimes(before);
    const reload = store.load(); expect(store.loading).toBe(true);
    request.resolve(); await Promise.all([first, second, reload]);
    expect(save).toHaveBeenCalledTimes(before);
    expect(store.status).toBe('ready'); expect(store.value.toolbar).toEqual({ kind: 'custom', pinned: ['background'] });
  });
  it('reloads clean external changes without treating in-memory migration as local edits', async () => {
    let disk: unknown = { schemaVersion: 1 };
    const save = vi.fn(async () => {}); const store = new PreferencesStore({ load: async () => disk, save });
    await store.load(); const listener = vi.fn(); store.subscribe(listener);
    disk = { ...custom(['background', 'bold']), keyboard: true }; await store.externalChange();
    expect(store.value).toMatchObject({ keyboard: true, toolbar: { pinned: ['background', 'bold'] } });
    expect(listener.mock.calls.some(([change]) => change.kind === 'preferences' && change.layoutChanged && change.eligibilityChanged)).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await store.setLayout({ kind: 'custom', pinned: ['bold', 'background'] });
    expect(save.mock.calls.at(-1)).toEqual([expect.objectContaining({ keyboard: true, toolbar: { mode: 'custom', pinned: ['bold', 'background'] } })]);
  });
  it('discards old loads and blocks all writes for unsupported data', async () => {
    const first = deferred<unknown>(), second = deferred<unknown>(); let count = 0;
    const save = vi.fn(async () => {});
    const store = new PreferencesStore({ load: () => ++count === 1 ? first.promise : second.promise, save });
    const old = store.load(); await settle(); const current = store.load(); await settle();
    second.resolve({ schemaVersion: 99 }); await current;
    first.resolve(null); await old;
    expect(store.status).toBe('schemaError');
    await store.set('automatic', false); await store.resetLayout(); await store.reset(); await store.save();
    expect(save).not.toHaveBeenCalled();
  });
  it('finishes an already started write after destroy but never starts the next one', async () => {
    const request = deferred(); const save = vi.fn(() => request.promise);
    const store = new PreferencesStore({ load: async () => null, save }); await store.load();
    const first = store.set('automatic', false), second = store.set('keyboard', true); await settle();
    const listener = vi.fn(); store.subscribe(listener); store.destroy(); request.resolve(); await Promise.all([first, second]);
    expect(save).toHaveBeenCalledTimes(1); expect(listener).not.toHaveBeenCalled(); expect(store.enabled).toBe(false);
  });
});

describe('localization and placement', () => {
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh_HK'])('uses Chinese for %s', language => expect(stringsFor(language).bold).toBe('加粗'));
  it.each(['en', 'fr', 'ja', 'ko', 'de', 'ru', ''])('uses English for %s', language => expect(stringsFor(language).bold).toBe('Bold'));
  it('interpolates localized action feedback with the same placeholders', () => {
    expect(translator(() => 'zh')('actionUnpinned', { name: '加粗' })).toBe('已将加粗移入“更多”。');
    expect(translator(() => 'en')('actionPosition', { name: 'Bold', position: 2, total: 5 })).toBe('Bold, position 2 of 5.');
    for (const key of Object.keys(stringsFor('en')) as (keyof ReturnType<typeof stringsFor>)[]) {
      expect([...stringsFor('zh')[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()).toEqual([...stringsFor('en')[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort());
    }
  });
  const bounds = { left: 0, right: 400, top: 0, bottom: 600 };
  it('uses the visible viewport or falls back to window dimensions', () => {
    expect(viewportBounds(1200, 800, { offsetLeft: 12, offsetTop: 40, width: 1000, height: 720 })).toEqual({ left: 12, right: 1012, top: 40, bottom: 760 });
    expect(viewportBounds(1200, 800, null)).toEqual({ left: 0, right: 1200, top: 0, bottom: 800 });
  });
  it('flips below, clamps horizontally and hides when there is insufficient space', () => {
    expect(place({ left: 0, right: 20, top: 10, bottom: 30 }, bounds, 200, 40)).toEqual({ left: 8, top: 38 });
    expect(place({ left: 380, right: 400, top: 300, bottom: 320 }, bounds, 200, 40)).toEqual({ left: 192, top: 252 });
    expect(place({ left: 0, right: 20, top: -10, bottom: 10 }, bounds, 200, 40)).toBeNull();
    expect(place({ left: 0, right: 20, top: 200, bottom: 220 }, bounds, 500, 40)).toBeNull();
  });
});
