import { describe, expect, it, vi } from 'vitest';
import { isCanonicalHex, normalizeHex } from '../src/formatting/colors';
import { locateFragment, parseFragment } from '../src/formatting/fragment';
import { formatFragment } from '../src/formatting/markdown';
import { copyHistory, EMPTY_HISTORY, applyColorUse, replayColorUses } from '../src/settings/color-history';
import { decodeSettings, encodeSettings } from '../src/settings/persistence';
import { DEFAULTS } from '../src/settings/model';
import { PreferencesStore } from '../src/settings/store';
import type { ColorKind } from '../src/formatting/types';

const A = '#aabbcc', B = '#112233', C = '#445566', D = '#778899';
const dto = (foreground: string[] = [], background: string[] = []) => encodeSettings(DEFAULTS, { foreground, background });
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}

describe('custom HEX and immutable usage records', () => {
  it.each(['#abc', '#ABC', '#aabbcc', ' #AABBCC '])('normalizes %s to one canonical color', value => expect(normalizeHex(value)).toBe(A));
  it.each([null, undefined, 42, '', 'abc', '#ab', '#abcd', '#aabbccdd', '#ab cd', 'red', 'rgb(1,2,3)', 'var(--x)', '#aabbcc;color:red', '<img src=x>', 'url(x)'])('rejects %s before formatting', value => expect(normalizeHex(value)).toBeNull());
  it('keeps the domain boundary stricter than the input boundary', () => {
    const located = locateFragment('word', 0, 4)!;
    for (const color of ['#abc', '#AABBCC', '#aabbcc\n', ' #aabbcc', 'url(x)']) {
      expect(isCanonicalHex(color)).toBe(false);
      expect(formatFragment(located, 'word', 'foreground', color)).toEqual({ kind: 'unavailable', reason: 'invalidParameter' });
    }
    const result = formatFragment(located, 'word', 'foreground', A);
    expect(result.kind).toBe('edit');
    if (result.kind === 'edit') expect(parseFragment(result.plan.insert)?.foreground).toBe(A);
  });
  it('isolates kinds, deduplicates and caps recency without mutating snapshots', () => {
    const initial = copyHistory({ foreground: [A, B], background: [C] });
    let next = applyColorUse(initial, 'foreground', B);
    expect(next).toEqual({ foreground: [B, A], background: [C] }); expect(initial.foreground).toEqual([A, B]);
    for (const color of [C, D, '#000000', '#ffffff']) next = applyColorUse(next, 'foreground', color);
    expect(next.foreground).toEqual(['#ffffff', '#000000', D, C, B]);
    expect(Object.isFrozen(next.foreground)).toBe(true); expect(() => copyHistory({ foreground: ['red'], background: [] })).toThrow();
    expect(replayColorUses(initial, { foreground: [C, B], background: [] }).foreground).toEqual([C, B, A]);
  });
  it.each(['#ABC', '#abc', 'red', '#aabbcc;color:red'])('asserts a canonical use before changing history: %s', color => {
    const initial = copyHistory({ foreground: [A], background: [B] });
    expect(() => applyColorUse(initial, 'foreground', color)).toThrow('Invalid color use');
    expect(initial).toEqual({ foreground: [A], background: [B] });
  });
  it('asserts the usage kind without modifying the input snapshot', () => {
    expect(() => applyColorUse(EMPTY_HISTORY, 'text' as ColorKind, A)).toThrow('Invalid color use');
    expect(EMPTY_HISTORY).toEqual({ foreground: [], background: [] });
  });
  it('migrates schema 2 and independently recovers or normalizes schema 3 histories', () => {
    const legacy = { ...dto(), schemaVersion: 2, automatic: false, toolbar: { mode: 'custom', pinned: ['background'] } };
    expect(decodeSettings(legacy)).toMatchObject({ migrated: true, historyRecovered: false, history: EMPTY_HISTORY, value: { automatic: false, toolbar: { pinned: ['background'] } } });
    expect(decodeSettings({ ...dto(), colorHistory: { foreground: [A, 'red'], background: [B] } })).toMatchObject({ historyRecovered: true, recovered: false, history: { foreground: [], background: [B] } });
    expect(decodeSettings({ ...dto(), colorHistory: { foreground: ['#ABC', A, B], background: [] } })).toMatchObject({ historyRecovered: true, history: { foreground: [A, B], background: [] } });
    const history = decodeSettings(dto([A])).history;
    const encoded = encodeSettings(DEFAULTS, history); (encoded.colorHistory.foreground as string[]).push(B);
    expect(history.foreground).toEqual([A]);
  });
});

describe('history persistence, isolation and reload races', () => {
  it('acknowledges an own-file echo arriving before save completion without a false unsaved status', async () => {
    let disk = dto(); const write = deferred();
    const store = new PreferencesStore({ load: async () => disk, save: async value => { disk = value; await write.promise; } });
    await store.load(); store.recordColorUse('foreground', A); await settle();
    const echo = store.externalChange(); write.resolve(); await echo; await settle();
    expect(store.history.foreground).toEqual([A]); expect(store.unsavedHistory).toBe(false); expect(store.historyStatus).toBe('ready');
    expect(store.canChangePreferences).toBe(true);
  });
  it('treats successful head reuse during a background read as local work before adopting external history', async () => {
    let delayed = false; const read = deferred<unknown>();
    const store = new PreferencesStore({ load: () => delayed ? read.promise : Promise.resolve(dto([A])), save: async () => {} });
    await store.load(); delayed = true; const external = store.externalChange(); await settle();
    store.recordColorUse('foreground', A); read.resolve(dto([B])); await external;
    expect(store.history.foreground).toEqual([A]); expect(store.historyStatus).toBe('conflict'); expect(store.enabled).toBe(true);
  });
  it('resumes automatic saving for new colors applied while a background read is paused', async () => {
    let delayed = false; const read = deferred<unknown>(); const save = vi.fn(async () => {});
    const store = new PreferencesStore({ load: () => delayed ? read.promise : Promise.resolve(dto([A])), save });
    await store.load(); delayed = true; const external = store.externalChange(); await settle();
    store.recordColorUse('foreground', B); expect(save).not.toHaveBeenCalled();
    read.resolve(dto([A])); await external; await settle();
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ colorHistory: { foreground: [B, A], background: [] } }));
    expect(store.unsavedHistory).toBe(false);
  });
  it('coalesces writes, preserves latest recency and keeps history failures outside preferences', async () => {
    const first = deferred(), last = deferred(); const saves: unknown[] = [];
    const store = new PreferencesStore({ load: async () => dto(), save: value => { saves.push(value); return saves.length === 1 ? first.promise : last.promise; } });
    await store.load(); const changes = vi.fn(); store.subscribe(changes);
    store.recordColorUse('foreground', A); await settle();
    store.recordColorUse('foreground', B); store.recordColorUse('foreground', A);
    expect(store.history.foreground).toEqual([A, B]); expect(saves).toHaveLength(1);
    first.resolve(); await settle(); expect(saves).toHaveLength(2); expect(store.unsavedHistory).toBe(true);
    last.reject(Error('disk')); await settle();
    expect(store.status).toBe('ready'); expect(store.historyStatus).toBe('saveError'); expect(store.enabled).toBe(true);
    expect(changes.mock.calls.some(([change]) => change.kind === 'preferences')).toBe(false);
    expect(saves.at(-1)).toMatchObject({ colorHistory: { foreground: [A, B] } }); store.destroy();
  });
  it('retries the latest snapshot and keeps resets separate from history clear', async () => {
    let fail = true; const writes: unknown[] = [];
    const store = new PreferencesStore({ load: async () => dto([A]), save: async value => { writes.push(value); if (fail) throw Error('disk'); } });
    await store.load(); store.recordColorUse('background', B); await settle();
    store.recordColorUse('background', C); await settle(); fail = false; await store.save();
    expect(writes.at(-1)).toMatchObject({ colorHistory: { foreground: [A], background: [C, B] } });
    expect(store.historyStatus).toBe('ready'); await store.reset(); expect(store.history.background).toEqual([C, B]);
    await store.clearColorHistory(); expect(store.history).toEqual(EMPTY_HISTORY); expect(store.value).toEqual(DEFAULTS);
  });
  it('adopts clean history-only changes without changing preferences or writing echoes', async () => {
    let disk = dto(); const save = vi.fn(async value => { disk = value; });
    const store = new PreferencesStore({ load: async () => disk, save }); await store.load();
    const changes = vi.fn(); store.subscribe(changes); disk = dto([A]); await store.externalChange();
    expect(store.history.foreground).toEqual([A]); expect(store.enabled).toBe(true); expect(save).not.toHaveBeenCalled();
    expect(changes.mock.calls.some(([change]) => change.kind === 'preferences')).toBe(false);
    store.recordColorUse('foreground', B); await settle(); const count = save.mock.calls.length;
    await store.externalChange(); expect(save).toHaveBeenCalledTimes(count); expect(store.historyStatus).toBe('ready');
  });
  it('keeps editing available during a history conflict and blocks every preference writer', async () => {
    let disk = dto(); let fail = true; const save = vi.fn(async value => { if (fail) throw Error('disk'); disk = value; });
    const store = new PreferencesStore({ load: async () => disk, save }); await store.load();
    store.recordColorUse('foreground', A); await settle(); disk = dto([B]); await store.externalChange();
    expect(store.historyStatus).toBe('conflict'); expect(store.enabled).toBe(true); expect(store.canChangePreferences).toBe(false);
    const count = save.mock.calls.length; store.recordColorUse('background', C); await store.set('automatic', false); await store.clearColorHistory(); await store.save();
    expect(store.value.automatic).toBe(true); expect(store.history.background).toEqual([C]); expect(save).toHaveBeenCalledTimes(count);
    fail = false; await store.reloadHistory(); expect(store.history).toEqual({ foreground: [B], background: [] }); expect(save).toHaveBeenCalledTimes(count);
  });
  it('retains post-click uses even when the first use leaves the memory head unchanged', async () => {
    let disk = dto([A, C]); const read = deferred<unknown>(); let delayed = false;
    const save = vi.fn(async value => { disk = value; });
    const store = new PreferencesStore({ load: () => delayed ? read.promise : Promise.resolve(disk), save }); await store.load();
    delayed = true; const reload = store.reloadHistory(); await settle();
    store.recordColorUse('foreground', A); store.recordColorUse('foreground', B); store.recordColorUse('foreground', A);
    store.recordColorUse('background', D);
    const writes = save.mock.calls.length; read.resolve(dto([C, D], [B])); await reload; await settle();
    expect(store.history).toEqual({ foreground: [A, B, C, D], background: [D, B] });
    expect(save.mock.calls.length).toBe(writes + 1); expect(disk).toMatchObject({ colorHistory: store.history }); expect(store.unsavedHistory).toBe(false);
  });
  it('retains uses while waiting for a previous write, and old completion cannot clear them', async () => {
    let disk = dto(); const write = deferred(); const read = deferred<unknown>(); let delayed = false;
    const save = vi.fn(async value => { if (!delayed) await write.promise; disk = value; });
    const store = new PreferencesStore({ load: () => delayed ? read.promise : Promise.resolve(disk), save }); await store.load();
    store.recordColorUse('foreground', A); await settle(); delayed = true;
    const reload = store.reloadHistory(); store.recordColorUse('foreground', B); write.resolve(); await settle();
    expect(store.unsavedHistory).toBe(true); read.resolve(dto([C])); await reload; await settle();
    expect(store.history.foreground).toEqual([B, C]); expect(disk).toMatchObject({ colorHistory: { foreground: [B, C] } });
  });
  it.each(['failed', 'superseded', 'destroyed'] as const)('does not install a %s reload result over later usage', async phase => {
    let loads = 0; const read = deferred<unknown>(); const later = deferred<unknown>(); const save = vi.fn(async () => {});
    const store = new PreferencesStore({ load: () => ++loads === 1 ? Promise.resolve(dto([A])) : loads === 2 ? read.promise : later.promise, save }); await store.load();
    const old = store.reloadHistory(); await settle(); store.recordColorUse('foreground', B);
    let current: Promise<void> | undefined;
    if (phase === 'superseded') { current = store.reloadHistory(); await settle(); store.recordColorUse('foreground', D); }
    if (phase === 'destroyed') store.destroy();
    if (phase === 'failed') read.reject(Error('read')); else read.resolve(dto([C]));
    await old; expect(store.history.foreground).toEqual(phase === 'superseded' ? [D, B, A] : [B, A]); expect(store.unsavedHistory).toBe(true);
    if (current) { later.resolve(dto([C])); await current; await settle(); expect(store.history.foreground).toEqual([D, C]); }
    if (phase === 'destroyed') expect(save).not.toHaveBeenCalled();
  });
});
