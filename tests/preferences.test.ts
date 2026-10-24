import { describe, expect, it } from 'vitest';
import { DEFAULTS, parsePreferences } from '../src/settings/model';
import { PreferencesStore } from '../src/settings/store';
import { stringsFor } from '../src/i18n';
import { place } from '../src/ui/position';

describe('preferences and localization', () => {
  it('loads first-run defaults without a false error', () => {
    expect(parsePreferences(null)).toEqual({ value: DEFAULTS, recovered: false });
    expect(parsePreferences({ schemaVersion: 1, automatic: 'yes' }).value.automatic).toBe(true);
    expect(() => parsePreferences({ schemaVersion: 2 })).toThrow('schema');
  });
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh_HK'])('uses Chinese for %s', language => expect(stringsFor(language).bold).toBe('加粗'));
  it.each(['en', 'fr', 'ja', 'ko', 'de', 'ru', ''])('uses English for %s', language => expect(stringsFor(language).bold).toBe('Bold'));
  it('keeps failed saves active and supports retry', async () => {
    let fail = true;
    const store = new PreferencesStore({ load: async () => null, save: async () => { if (fail) throw Error('disk'); } });
    await store.load(); await store.set('automatic', false);
    expect(store.enabled).toBe(true); expect(store.status).toBe('saveError'); expect(store.value.automatic).toBe(false);
    fail = false; await store.save(); expect(store.status).toBe('ready');
  });
  it('serializes rapid writes and never saves on incompatible schema', async () => {
    const values: boolean[] = [];
    const store = new PreferencesStore({ load: async () => null, save: async value => { values.push(value.automatic); } });
    await store.load(); await Promise.all([store.set('automatic', false), store.set('automatic', true)]);
    expect(values).toEqual([false, true]); expect(store.value.automatic).toBe(true);
    const newer = new PreferencesStore({ load: async () => ({ schemaVersion: 99 }), save: async () => { throw Error('Must not save'); } });
    await newer.load(); await newer.set('automatic', false); expect(newer.status).toBe('schemaError');
  });
});

describe('toolbar placement', () => {
  const bounds = { left: 0, right: 400, top: 0, bottom: 600 };
  it('flips below at the top, clamps horizontally and hides when offscreen', () => {
    expect(place({ left: 0, right: 20, top: 10, bottom: 30 }, bounds, 200, 40)).toEqual({ left: 8, top: 38 });
    expect(place({ left: 380, right: 400, top: 300, bottom: 320 }, bounds, 200, 40)).toEqual({ left: 192, top: 252 });
    expect(place({ left: 0, right: 20, top: -10, bottom: 10 }, bounds, 200, 40)).toBeNull();
    expect(place({ left: 0, right: 20, top: 200, bottom: 220 }, bounds, 500, 40)).toBeNull();
  });
});
