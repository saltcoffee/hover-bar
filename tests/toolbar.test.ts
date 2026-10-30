import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, expect as domExpect, type Browser, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backState, expandedPanel, type PanelState } from '../src/ui/panel-navigation';
import type { ActionId } from '../src/toolbar/layout';
import { PALETTE } from '../src/formatting/colors';
import type { FixtureOptions } from './browser/toolbar-fixture';

describe('bounded panel navigation', () => {
  it.each(['foreground', 'background'] as const)('returns from a direct %s palette to the bar', palette => {
    const state: PanelState = { kind: 'palette', palette, origin: { kind: 'bar', actionId: palette } };
    expect(expandedPanel(state, palette)).toBe(true); expect(expandedPanel(state, 'more')).toBe(false);
    expect(backState(state)).toEqual({ kind: 'none' });
  });
  it.each(['foreground', 'background', 'chooseNote'] as const)('preserves the More origin, row and scroll when returning from %s', id => {
    const origin = { kind: 'more', actionId: id, scrollTop: 127 } as const;
    const state: PanelState = id === 'chooseNote' ? { kind: 'notes', origin } : { kind: 'palette', palette: id, origin };
    expect(expandedPanel(state, 'more')).toBe(true);
    const parent = backState(state);
    expect(parent).toEqual({ kind: 'more', scrollTop: 127, focusId: id });
    expect(backState(parent)).toEqual({ kind: 'none' });
  });
  it('returns from direct notes without retaining an old More parent', () => {
    const state: PanelState = { kind: 'notes', origin: { kind: 'bar', actionId: 'chooseNote' } };
    expect(backState(state)).toEqual({ kind: 'none' }); expect(expandedPanel(state, 'more')).toBe(false);
  });
});

// Real Toolbar + panels + NotePicker, with native Chromium focus, Tab and CSS geometry.
// The controller cases also retain real CodeMirror; only the Obsidian SDK is adapted.
describe('Toolbar DOM integration', () => {
  let browser: Browser;
  let page: Page;
  let fixtureUrl: string;
  let errors: string[];
  const bar = (id: string) => `.hover-bar [data-action="${id}"]`;
  const row = (id: string) => `.hover-bar-panel [data-action="${id}"]`;
  const panel = '.hover-bar-panel';
  const back = '.hover-bar-back';
  const input = '.hover-bar-search';
  const swatches = '.hover-bar-swatch';
  const reset = '.hover-bar-panel-body > button';

  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hoverbar-toolbar-'));
    await build({ entryPoints: [fileURLToPath(new URL('./browser/toolbar-fixture.ts', import.meta.url))],
      bundle: true, format: 'iife', platform: 'browser', outfile: join(directory, 'fixture.js'),
      alias: { obsidian: fileURLToPath(new URL('./browser/obsidian.ts', import.meta.url)) },
    });
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="${new URL('../styles.css', import.meta.url).href}">
      <style>*{box-sizing:border-box}body{margin:0}#editor{margin:180px 0 0 20px;height:440px;border:1px solid gray}
      .cm-editor{height:100%}.cm-content{font:16px/1.6 monospace}#outside{margin:30px}</style>
      </head><body><div id="editor"></div><script src="fixture.js"></script></body></html>`);
    fixtureUrl = pathToFileURL(join(directory, 'index.html')).href;
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  }, 30000);
  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixtureUrl);
  });
  afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });
  afterAll(async () => { await browser?.close(); });

  async function mount(options: FixtureOptions = {}): Promise<void> {
    await page.evaluate(options => window.toolbarTest.mount(options), options);
    await domExpect(page.locator('.hover-bar-layer')).toBeVisible();
  }
  async function activate(selector: string): Promise<void> { await page.locator(selector).focus(); await page.keyboard.press('Enter'); }
  async function open(id: ActionId, origin: 'bar' | 'more'): Promise<void> {
    if (origin === 'more') { await activate(bar('more')); await activate(row(id)); }
    else await activate(bar(id));
  }
  async function focused(selector: string): Promise<void> { await domExpect(page.locator(selector)).toBeFocused({ timeout: 1000 }); }

  for (const origin of ['bar', 'more'] as const) {
    it.each(['foreground', 'background', 'chooseNote'] as const)(`restores ${origin} origin on Escape from %s`, async id => {
      await mount({ pinned: origin === 'bar' ? [id] : [] }); await open(id, origin);
      await focused(id === 'chooseNote' ? input : `${swatches}:first-child`);
      await domExpect(page.locator(bar(origin === 'bar' ? id : 'more'))).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      if (origin === 'more') {
        await focused(row(id)); await domExpect(page.locator(panel)).toBeVisible();
        await page.keyboard.press('Escape'); await focused(bar('more'));
      } else await focused(bar(id));
      await domExpect(page.locator(panel)).toBeHidden();
      await page.keyboard.press('Escape');
      await domExpect(page.locator('.hover-bar-layer')).toBeHidden();
      expect(await page.evaluate(() => window.toolbarTest.inspect().events)).toEqual([{ type: 'close' }]);
    });

    it.each(['foreground', 'background', 'chooseNote'] as const)(`uses Back to return %s to ${origin}`, async id => {
      await mount({ pinned: origin === 'bar' ? [id] : [] }); await open(id, origin);
      await activate(back); await focused(origin === 'bar' ? bar(id) : row(id));
      await domExpect(page.locator(panel))[origin === 'bar' ? 'toBeHidden' : 'toBeVisible']();
    });

    it.each(['applied', 'unchanged', 'rejected', 'closed'] as const)(`handles %s color outcomes from ${origin}`, async outcome => {
      await mount({ pinned: origin === 'bar' ? ['foreground'] : [], outcome }); await open('foreground', origin);
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.toolbarTest.inspect().events)).toEqual([
        { type: 'format', action: 'foreground', color: PALETTE[0].foreground },
      ]);
      if (outcome === 'closed') await domExpect(page.locator('.hover-bar-layer')).toBeHidden();
      else if (outcome === 'rejected') { await focused(`${swatches}:first-child`); await domExpect(page.locator(panel)).toBeVisible(); }
      else { await focused(bar(origin === 'bar' ? 'foreground' : 'more')); await domExpect(page.locator(panel)).toBeHidden(); }
    });

    it(`returns an ambiguous quick link picker to its ${origin} entry`, async () => {
      await mount({ pinned: origin === 'bar' ? ['link'] : [] }); await open('link', origin);
      await focused(input); await page.keyboard.press('Escape');
      await focused(origin === 'bar' ? bar('link') : row('link'));
      expect(await page.evaluate(() => window.toolbarTest.inspect().events)).toEqual([{ type: 'quickLink' }]);
    });

    it(`keeps native notes Tab transfers inside the ${origin} session and lets Tab exit`, async () => {
      await mount({ controller: true, pinned: origin === 'bar' ? ['chooseNote'] : [] });
      await open('chooseNote', origin); await focused(input);
      await page.locator(input).fill('Concept');
      await page.keyboard.press('Shift+Tab'); await focused(back);
      await page.keyboard.press('Tab'); await focused(input);
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
      await focused(bar(origin === 'bar' ? 'chooseNote' : 'more'));
      await page.keyboard.press('Tab'); await focused(back);
      await page.keyboard.press('Tab'); await focused(input);
      expect(await page.locator(input).inputValue()).toBe('Concept');
      expect(await page.evaluate(() => window.toolbarTest.inspect())).toMatchObject({
        scope: { pushes: 1, pops: 0 }, text: 'before text after', selection: [7, 11],
      });
      await page.keyboard.press('Tab'); await focused('#outside');
      await domExpect(page.locator('.hover-bar-layer')).toBeHidden();
      expect(await page.evaluate(() => window.toolbarTest.inspect().scope)).toEqual({ pushes: 1, pops: 1 });
    });

    it(`keeps forward native Tab from Back inside the ${origin} notes page`, async () => {
      await mount({ controller: true, pinned: origin === 'bar' ? ['chooseNote'] : [] }); await open('chooseNote', origin);
      await page.locator(back).focus(); await page.keyboard.press('Tab'); await focused(input);
      await domExpect(page.locator('.hover-bar-layer')).toBeVisible();
      expect(await page.evaluate(() => window.toolbarTest.inspect().scope)).toEqual({ pushes: 1, pops: 0 });
    });
  }

  it('restores the More scroll position and original row', async () => {
    await mount({ pinned: [] }); await activate(bar('more'));
    await page.locator(row('foreground')).focus();
    const scroll = await page.locator('.hover-bar-panel-body').evaluate(element => { element.scrollTop = 70; return element.scrollTop; });
    expect(scroll).toBeGreaterThan(0);
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await focused(row('foreground'));
    expect(await page.locator('.hover-bar-panel-body').evaluate(element => element.scrollTop)).toBe(scroll);
  });

  it('routes arrows to the actual focus region while a panel is open and maintains one bar Tab stop', async () => {
    await mount({ pinned: ['bold', 'foreground'] }); await open('foreground', 'bar');
    await page.locator(bar('foreground')).focus(); await page.keyboard.press('ArrowLeft'); await focused(bar('bold'));
    await page.keyboard.press('End'); await focused(bar('more'));
    await page.keyboard.press('ArrowRight'); await focused(bar('bold'));
    expect(await page.locator('.hover-bar button[tabindex="0"]').count()).toBe(1);
    await domExpect(page.locator(panel)).toBeVisible();
    await page.keyboard.press('Tab'); await focused(back);
    await page.keyboard.press('ArrowDown'); await focused(`${swatches}:first-child`);
    await page.keyboard.press('ArrowRight'); await focused('[data-swatch="orange"]');
    await page.keyboard.press('Shift+Tab'); await focused(back);
    await page.keyboard.press('Shift+Tab'); await focused(bar('foreground'));
  });

  it('keeps disabled actions reachable and explains them without closing the More path', async () => {
    await mount({ pinned: ['bold', 'italic'], disabled: ['bold'] }); await focused(bar('italic'));
    await page.keyboard.press('Home'); await focused(bar('bold')); await page.keyboard.press('Enter');
    await domExpect(page.locator(bar('bold'))).toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => window.toolbarTest.mount({ pinned: [], disabled: ['bold'] }));
    await activate(bar('more')); await activate(row('bold'));
    await domExpect(page.locator(panel)).toBeVisible(); await focused(row('bold'));
    expect(await page.evaluate(() => window.toolbarTest.inspect().events)).toEqual([{ type: 'explain', action: 'Unavailable here' }]);
  });

  it('hands a shrinking bar focus to More, then restores a row moved into the bar', async () => {
    await mount({ pinned: ['bold', 'foreground'] }); await page.locator(bar('foreground')).focus();
    await page.evaluate(() => window.toolbarTest.layout(100)); await focused(bar('more'));
    await activate(bar('more')); await page.locator(row('foreground')).focus();
    await page.evaluate(() => window.toolbarTest.layout(640)); await focused(bar('foreground'));
    await domExpect(page.locator(row('foreground'))).toHaveCount(0);
    await page.keyboard.press('ArrowLeft'); await focused(bar('bold'));
  });

  it('returns a More subpage to the current bar entry after it moves, then navigates the bar', async () => {
    await mount({ pinned: ['bold', 'foreground'], width: 100 }); await open('foreground', 'more');
    await page.evaluate(() => window.toolbarTest.layout(640)); await page.keyboard.press('Escape');
    await focused(bar('foreground')); await domExpect(page.locator(panel)).toBeVisible();
    await page.keyboard.press('ArrowLeft'); await focused(bar('bold'));
    await page.keyboard.press('Escape'); await focused(bar('more')); await domExpect(page.locator(panel)).toBeHidden();
  });

  it('restores a direct subpage to More when its entry has been collected', async () => {
    await mount({ pinned: ['bold', 'foreground'] }); await open('foreground', 'bar');
    await page.evaluate(() => window.toolbarTest.layout(100)); await page.keyboard.press('Escape');
    await focused(bar('more')); await domExpect(page.locator(panel)).toBeHidden();
  });

  it('keeps the same search input, query and focus across width and entry changes', async () => {
    await mount({ pinned: ['chooseNote'] }); await open('chooseNote', 'bar'); await page.locator(input).fill('Concept');
    const original = await page.locator(input).elementHandle();
    await page.evaluate(() => window.toolbarTest.layout(70));
    expect(await original!.evaluate(node => node === document.activeElement && node.isConnected)).toBe(true);
    expect(await page.locator(input).inputValue()).toBe('Concept');
    await page.keyboard.press('Escape'); await focused(bar('more')); await original!.dispose();
  });

  it('bridges focus before switching away from notes, and repeated activation clears the path', async () => {
    await mount({ pinned: ['chooseNote', 'foreground'] }); await open('chooseNote', 'bar');
    const original = await page.locator(input).elementHandle();
    // Click dispatch preserves the old input focus until Toolbar performs the handoff.
    await page.locator(bar('foreground')).click(); await focused(`${swatches}:first-child`);
    expect(await original!.evaluate(node => node.isConnected)).toBe(false);
    await page.keyboard.press('Escape'); await focused(bar('foreground')); await domExpect(page.locator(panel)).toBeHidden();
    await open('foreground', 'bar'); await activate(bar('foreground'));
    await focused(bar('foreground')); await domExpect(page.locator(panel)).toBeHidden(); await original!.dispose();
  });

  it('does not acquire UI focus while a layout changes outside the toolbar', async () => {
    await mount({ pinned: ['bold', 'foreground'] }); await page.locator('#outside').focus();
    await page.evaluate(() => window.toolbarTest.layout(100)); await focused('#outside');
  });

  it('retains a real controller session and editor selection during bar and More focus handoffs', async () => {
    await mount({ controller: true, pinned: ['bold', 'foreground'] }); await page.locator(bar('foreground')).focus();
    await page.evaluate(() => window.toolbarTest.resizeEditor(100));
    expect(await page.evaluate(() => window.toolbarTest.inspect().events)).toEqual([]);
    await domExpect(page.locator(bar('foreground'))).toHaveCount(0, { timeout: 1000 }); await focused(bar('more'));
    await activate(bar('more')); await page.locator(row('foreground')).focus();
    await page.evaluate(() => window.toolbarTest.resizeEditor(640));
    await focused(bar('foreground')); await domExpect(page.locator('.hover-bar-layer')).toBeVisible();
    expect(await page.evaluate(() => window.toolbarTest.inspect())).toMatchObject({
      scope: { pushes: 1, pops: 0 }, text: 'before text after', selection: [7, 11],
    });
  });

  it('releases keyboard ownership on return to the editor, and closes on focus leaving both regions', async () => {
    await mount({ controller: true, pinned: ['chooseNote'] });
    await page.keyboard.press('Shift+Tab'); await focused('.cm-content');
    await domExpect(page.locator('.hover-bar-layer')).toBeVisible();
    expect(await page.evaluate(() => window.toolbarTest.inspect().scope)).toEqual({ pushes: 1, pops: 1 });
    await page.keyboard.press('Tab'); await focused(bar('chooseNote'));
    await page.locator('#outside').focus(); await domExpect(page.locator('.hover-bar-layer')).toBeHidden();
    expect(await page.evaluate(() => window.toolbarTest.inspect().scope)).toEqual({ pushes: 2, pops: 2 });
  });

  it('returns to the original editor and selection on the third Escape from More notes', async () => {
    await mount({ controller: true, pinned: [] }); await open('chooseNote', 'more');
    await page.keyboard.press('Escape'); await focused(row('chooseNote'));
    await page.keyboard.press('Escape'); await focused(bar('more'));
    await page.keyboard.press('Escape'); await focused('.cm-content');
    await domExpect(page.locator('.hover-bar-layer')).toBeHidden();
    expect(await page.evaluate(() => window.toolbarTest.inspect())).toMatchObject({
      scope: { pushes: 1, pops: 1 }, text: 'before text after', selection: [7, 11],
    });
  });

  it('does not steal focus after a null-destination blur', async () => {
    await mount({ controller: true, pinned: ['chooseNote'] }); await open('chooseNote', 'bar');
    await page.locator(input).evaluate(element => (element as HTMLInputElement).blur());
    await domExpect(page.locator('.hover-bar-layer')).toBeHidden(); await focused('body');
    expect(await page.evaluate(() => window.toolbarTest.inspect().scope)).toEqual({ pushes: 1, pops: 1 });
  });

  for (const kind of ['foreground', 'background'] as const) {
    it.each([1, 2, 3, 4])(`navigates every ${kind} color, Back, reset and Tab at %i columns`, async columns => {
      await mount({ pinned: [] }); await open(kind, 'more');
      // Panel padding + border = 22, outer viewport inset = 16.
      const contentWidth = columns * 32 + (columns - 1) * 8;
      const measurement = await page.evaluate(width => window.toolbarTest.layout(width), contentWidth + 38);
      expect(measurement.panel).toMatchObject({ columns, fits: true });
      const sizes = await page.locator(swatches).evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height, top: rect.top };
      }));
      expect(new Set(sizes.map(size => size.top)).size).toBe(Math.ceil(PALETTE.length / columns));
      expect(sizes.every(size => size.width >= 32 && size.height >= 36)).toBe(true);
      for (let i = 0; i < PALETTE.length; i++) {
        await focused(`[data-swatch="${PALETTE[i]!.id}"]`);
        await page.keyboard.press('ArrowRight');
      }
      await focused('[data-swatch="gray"]'); await page.keyboard.press('ArrowDown'); await focused(reset);
      await page.keyboard.press('ArrowUp'); await focused('[data-swatch="gray"]');
      await page.keyboard.press('Home'); await focused('[data-swatch="red"]');
      await page.keyboard.press('ArrowLeft'); await focused('[data-swatch="red"]');
      await page.keyboard.press('ArrowUp'); await focused(back);
      await page.keyboard.press('ArrowDown'); await focused('[data-swatch="red"]');
      await page.keyboard.press('ArrowDown'); await focused(`[data-swatch="${PALETTE[columns]!.id}"]`);
      await page.keyboard.press('ArrowUp'); await focused('[data-swatch="red"]');
      await page.keyboard.press('End'); await focused('[data-swatch="gray"]');
      // Last partial row clamps downward movement to the last swatch (three columns).
      if (columns === 3) {
        await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await focused('[data-swatch="gray"]');
      }
      await page.keyboard.press('Shift+Tab'); await focused(back);
      await page.keyboard.press('Tab'); await focused('[data-swatch="gray"]');
      expect(await page.locator(`${swatches}[tabindex="0"]`).count()).toBe(1);
      await page.keyboard.press('Tab'); await focused(reset);
      await page.keyboard.press('Shift+Tab'); await focused('[data-swatch="gray"]');
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await focused('#outside');
    });
  }

  it.each([31, 32, 71, 72, 111, 112, 151, 152])('measures real panel content at the %ipx threshold', async content => {
    await mount({ pinned: [] }); await open('foreground', 'more');
    const measurement = await page.evaluate(width => window.toolbarTest.layout(width), content + 38);
    expect(measurement.panel.columns).toBe(Math.min(4, Math.floor((content + 8) / 40)));
    expect(measurement.fits).toBe(content >= 32);
    if (content >= 32) {
      const size = await page.locator(swatches).first().boundingBox();
      expect(size!.width).toBeGreaterThanOrEqual(32); expect(size!.height).toBeGreaterThanOrEqual(36);
    }
  });

  it('preserves the focused swatch node and roving stop as the actual column count changes', async () => {
    await mount({ pinned: [] }); await open('foreground', 'more');
    await page.keyboard.press('End'); const original = await page.locator('[data-swatch="gray"]').elementHandle();
    for (const width of [116, 190, 150, 70, 640]) {
      const measurement = await page.evaluate(width => window.toolbarTest.layout(width), width);
      expect(await original!.evaluate(node => node === document.activeElement && node.isConnected && (node as HTMLElement).tabIndex === 0)).toBe(true);
      await page.keyboard.press('ArrowUp');
      await focused(`[data-swatch="${PALETTE[7 - measurement.panel.columns]!.id}"]`);
      await page.keyboard.press('End');
    }
    await original!.dispose();
  });
});
