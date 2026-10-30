import { describe, expect, it } from 'vitest';
import { ACTION_IDS, BASIC_FORMAT_IDS, DEFAULT_PINNED, fitLayout, layoutWidth, paletteColumns, resolveLayout, type ActionId, type LayoutMetrics } from '../src/toolbar/layout';

const metrics: LayoutMetrics = { widths: Object.fromEntries([...ACTION_IDS, 'more'].map(id => [id, 32])) as Record<ActionId | 'more', number>, shell: 14, gap: 2, groupGap: 6 };

describe('toolbar width allocation', () => {
  it('preserves the default order, reserves More and makes all ten actions reachable exactly once', () => {
    const result = fitLayout(resolveLayout({ kind: 'default' }), metrics, 500);
    expect(result.bar).toEqual(DEFAULT_PINNED); expect(result.overflow).toEqual(['clearColors']); expect(result.width).toBe(364);
  });
  it('accepts all-unpinned and all-pinned layouts, and handles the exact minimum width', () => {
    expect(fitLayout(resolveLayout({ kind: 'custom', pinned: [] }), metrics, 46)).toMatchObject({ fits: true, bar: [], overflow: ACTION_IDS });
    expect(fitLayout(resolveLayout({ kind: 'custom', pinned: [] }), metrics, 45.99).fits).toBe(false);
    expect(fitLayout(resolveLayout({ kind: 'custom', pinned: ACTION_IDS }), metrics, 1000).overflow).toEqual([]);
  });
  it('keeps custom order as a prefix, regardless of active formats or differing widths', () => {
    const custom = { kind: 'custom', pinned: ['background', 'bold', 'strike'] } as const;
    const wideFirst = { ...metrics, widths: { ...metrics.widths, background: 150 } };
    const result = fitLayout(resolveLayout(custom, ['strike']), wideFirst, 100);
    expect(result.bar).toEqual([]); expect(result.overflow.slice(0, 3)).toEqual(custom.pinned);
    expect(resolveLayout(custom, BASIC_FORMAT_IDS)).toEqual(resolveLayout(custom));
  });
  it('keeps an active highlight directly cancellable in the documented 320px pane', () => {
    const result = fitLayout(resolveLayout({ kind: 'default' }, ['highlight']), metrics, 304);
    expect(result.bar).toEqual(['bold', 'strike', 'highlight', 'foreground', 'background', 'link', 'chooseNote']); expect(result.width).toBe(296);
    expect(fitLayout(resolveLayout({ kind: 'default' }), metrics, 304).bar).not.toContain('highlight');
  });
  it('preserves old default entries whenever the old toolbar fits, including active combinations', () => {
    for (let mask = 0; mask < 32; mask++) {
      const active = BASIC_FORMAT_IDS.filter((_id, index) => mask & (1 << index));
      for (let pane = 80; pane <= 500; pane += 2) {
        const budget = pane - 16;
        const old = DEFAULT_PINNED.filter(id => pane >= 384 || !['italic', 'code', 'highlight'].includes(id) || active.includes(id as typeof active[number]));
        const result = fitLayout(resolveLayout({ kind: 'default' }, active), metrics, budget);
        if (layoutWidth(old, true, metrics) <= budget) expect(old.every(id => result.bar.includes(id))).toBe(true);
        expect(new Set([...result.bar, ...result.overflow])).toEqual(new Set(ACTION_IDS));
        expect(result.bar.length + result.overflow.length).toBe(ACTION_IDS.length);
      }
    }
  });
  it('is monotonic with a fixed priority and rejects invalid inputs instead of masking them', () => {
    const view = resolveLayout({ kind: 'custom', pinned: ['highlight', 'clearColors', 'bold', 'chooseNote'] });
    let previous = 0;
    for (let width = 46; width < 500; width++) {
      const result = fitLayout(view, metrics, width); expect(result.bar.length).toBeGreaterThanOrEqual(previous); previous = result.bar.length;
      expect(result.width).toBeLessThanOrEqual(width);
    }
    expect(() => fitLayout({ ...view, priority: [] }, metrics, 500)).toThrow();
    expect(() => resolveLayout({ kind: 'custom', pinned: ['bold', 'bold'] })).toThrow();
  });
  it.each([[31, 0], [32, 1], [71, 1], [72, 2], [111, 2], [112, 3], [151, 3], [152, 4], [78, 2]])('uses %s pixels of content for %s palette columns', (width, columns) => {
    expect(paletteColumns(width)).toBe(columns);
    if (columns) expect((width - (columns - 1) * 8) / columns).toBeGreaterThanOrEqual(32);
  });
});
