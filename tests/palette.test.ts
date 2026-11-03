import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPalette } from '../src/ui/color-palette';
import type { ToolbarActions, ToolbarViewModel } from '../src/ui/toolbar-types';
import { TestDocument } from './support/dom';

vi.mock('obsidian', () => ({ setIcon: vi.fn() }));

afterEach(() => { vi.useRealTimers(); });

function inputSetup() {
  vi.useFakeTimers();
  const document = new TestDocument(), body = document.createElement('div'), back = document.createElement('button');
  document.body.append(back, body);
  const submit = vi.fn();
  const model = { recent: { foreground: [], background: [] }, palettes: { foreground: [], background: [] },
    colors: { foreground: undefined, background: undefined }, resets: { foreground: { enabled: true }, background: { enabled: true } } } as unknown as ToolbarViewModel;
  const palette = new ColorPalette(document as unknown as Document, body as unknown as HTMLElement, back as unknown as HTMLButtonElement,
    'foreground', key => key, {} as ToolbarActions, submit, model);
  palette.input.value = '#abc';
  const key = (type: 'keydown' | 'keyup', composing = false, repeat = false) => palette.input.dispatchEvent(Object.assign(new Event(type, { cancelable: true }),
    { key: 'Enter', isComposing: composing, keyCode: composing ? 229 : 13, repeat }));
  return { palette, submit, key };
}

describe('custom color composition confirmation', () => {
  it('keeps a composing Enter held across timers and auto-repeat until keyup', () => {
    const { palette, submit, key } = inputSetup();
    palette.input.dispatchEvent(new Event('compositionstart')); key('keydown', true);
    palette.input.dispatchEvent(new Event('compositionend')); vi.runAllTimers();
    key('keydown', false, true); key('keydown', false, true);
    expect(submit).not.toHaveBeenCalled();
    key('keyup'); key('keydown'); expect(submit).toHaveBeenCalledExactlyOnceWith('foreground', '#aabbcc'); palette.dispose();
  });
  it('also holds the confirmation key when compositionend precedes its first keydown', () => {
    const { palette, submit, key } = inputSetup();
    palette.input.dispatchEvent(new Event('compositionstart')); palette.input.dispatchEvent(new Event('compositionend'));
    key('keydown'); vi.runAllTimers(); key('keydown', false, true); expect(submit).not.toHaveBeenCalled();
    key('keyup'); key('keydown'); expect(submit).toHaveBeenCalledTimes(1); palette.dispose();
  });
  it('allows a fresh Enter after non-keyboard composition confirmation', () => {
    const { palette, submit, key } = inputSetup();
    palette.input.dispatchEvent(new Event('compositionstart')); palette.input.dispatchEvent(new Event('compositionend')); vi.runAllTimers();
    key('keydown'); expect(submit).toHaveBeenCalledExactlyOnceWith('foreground', '#aabbcc'); palette.dispose();
  });
  it('does not keep an old held key after the input loses focus', () => {
    const { palette, submit, key } = inputSetup();
    palette.input.dispatchEvent(new Event('compositionstart')); key('keydown', true);
    palette.input.dispatchEvent(new Event('compositionend')); vi.runAllTimers();
    palette.input.dispatchEvent(new Event('blur')); key('keydown');
    expect(submit).toHaveBeenCalledExactlyOnceWith('foreground', '#aabbcc'); palette.dispose();
  });
});

function setup(columns: number) {
  const document = new TestDocument();
  const back = document.createElement('button'), body = document.createElement('div'), reset = document.createElement('button');
  const input = document.createElement('input'), apply = document.createElement('button');
  const buttons = new Map(Array.from({ length: 8 }, (_value, index) => [String(index), document.createElement('button')]));
  for (const [id, button] of buttons) { button.dataset.swatch = id; button.tabIndex = id === '0' ? 0 : -1; body.append(button); }
  body.append(input, apply, reset); document.body.append(back, body);
  const palette = Object.create(ColorPalette.prototype) as ColorPalette;
  const order = [...buttons.keys()].map(color => ({ color }));
  Object.assign(palette, { document, body, back, reset, input, apply, columns,
    grids: { recent: { buttons: new Map(), order: [] }, presets: { buttons, order } } });
  const key = (value: string, shiftKey = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: value, shiftKey });
    palette.onKey(event as unknown as KeyboardEvent); return event;
  };
  return { document, body, palette, back, reset, input, apply, swatches: [...buttons.values()], key };
}

describe('palette focus scroll calculation', () => {
  it('calculates before writing and rechecks the retained focus after geometry changes', () => {
    const { document, body, palette, swatches } = setup(4);
    let viewportHeight = 200, itemTop = 81;
    vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: viewportHeight, height: viewportHeight, left: 0, right: 200, width: 200 }));
    vi.spyOn(swatches[0]!, 'getBoundingClientRect').mockImplementation(() => ({ top: itemTop - body.scrollTop, bottom: itemTop + 36 - body.scrollTop, height: 36, left: 0, right: 36, width: 36 }));
    document.body.scrollTop = 7; palette.focus();
    expect(palette.readScrollTop(53)).toBe(64); expect(body.scrollTop).toBe(0);
    expect(palette.applyScrollTop(64, true)).toBe(true);
    viewportHeight = 53; itemTop = 140;
    expect(palette.readScrollTop(53)).toBe(123); expect(palette.applyScrollTop(123, false)).toBe(true);
    expect(document.activeElement).toBe(swatches[0]); expect(document.body.scrollTop).toBe(7);
    body.scrollTop = 0; expect(palette.readScrollTop(53)).toBe(0);
  });
  it('requests visibility again on resize without changing which control is focused', () => {
    const { document, body, palette, swatches } = setup(4);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 53, height: 53, left: 0, right: 200, width: 200 });
    vi.spyOn(swatches[7]!, 'getBoundingClientRect').mockReturnValue({ top: 81, bottom: 117, height: 36, left: 0, right: 36, width: 36 });
    swatches[7]!.focus(); palette.applyScrollTop(0, true);
    expect(palette.readScrollTop(53)).toBe(64); expect(document.activeElement).toBe(swatches[7]);
  });
  it('rounds scroll adjustments toward full visibility at fractional pixel boundaries', () => {
    const { body, palette, swatches } = setup(4);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 0.25, bottom: 53.25, height: 53, left: 0, right: 200, width: 200 });
    const item = vi.spyOn(swatches[0]!, 'getBoundingClientRect').mockReturnValue({ top: 81.75, bottom: 117.75, height: 36, left: 0, right: 36, width: 36 });
    palette.focus(); expect(palette.readScrollTop(53)).toBe(65);
    body.scrollTop = 65; item.mockReturnValue({ top: -0.25, bottom: 35.75, height: 36, left: 0, right: 36, width: 36 });
    expect(palette.readScrollTop(53)).toBe(64);
  });
  it('does not scroll for focus outside the palette body', () => {
    const { document, body, palette, back } = setup(4);
    body.scrollTop = 25; back.focus(); palette.applyScrollTop(25, true);
    expect(palette.readScrollTop(36)).toBe(25); expect(document.activeElement).toBe(back);
  });
});

describe('palette keyboard navigation', () => {
  it.each([1, 2, 3, 4])('uses the applied %s-column grid without crossing group boundaries', columns => {
    const { document, swatches, key } = setup(columns);
    swatches[0]!.focus(); key('ArrowDown'); expect(document.activeElement).toBe(swatches[columns]);
    key('Home'); key('ArrowUp'); expect(document.activeElement).toBe(swatches[0]);
    key('End'); key('ArrowDown'); expect(document.activeElement).toBe(swatches[7]);
    key('ArrowUp'); expect(document.activeElement).toBe(swatches[7 - columns]);
  });
  it('hands Tab focus between Back, the roving color, HEX, Apply and reset without trapping exit', () => {
    const { document, swatches, back, input, apply, reset, key } = setup(1);
    back.focus(); key('Tab'); expect(document.activeElement).toBe(swatches[0]);
    key('End'); expect(swatches[7]!.tabIndex).toBe(0); expect(swatches[0]!.tabIndex).toBe(-1);
    key('Tab'); expect(document.activeElement).toBe(input);
    // Text input uses native Tab, caret and selection behavior.
    expect(key('ArrowLeft').defaultPrevented).toBe(false);
    apply.focus(); key('Tab'); expect(document.activeElement).toBe(reset);
    key('Tab', true); expect(document.activeElement).toBe(apply);
    swatches[7]!.focus(); key('Tab', true); expect(document.activeElement).toBe(back);
    expect(key('Tab', true).defaultPrevented).toBe(false);
    reset.focus(); expect(key('Tab').defaultPrevented).toBe(false);
  });
  it('keeps navigation inside a partial last row and does not consume typing keys', () => {
    const { document, swatches, key } = setup(3);
    swatches[5]!.focus(); key('ArrowDown'); expect(document.activeElement).toBe(swatches[7]);
    expect(key('a').defaultPrevented).toBe(false);
  });
});
