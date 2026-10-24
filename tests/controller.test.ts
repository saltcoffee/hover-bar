import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { EditorController } from '../src/editor/controller';
import type { SelectionSnapshot } from '../src/editor/context';
import { locateFragment } from '../src/formatting/fragment';
import { PreferencesStore } from '../src/settings/store';
import type { Box, Position } from '../src/ui/position';

const scenario = vi.hoisted(() => ({ snapshot: undefined as SelectionSnapshot | undefined, resize: () => {} }));
vi.mock('../src/editor/context', async importOriginal => ({
  ...await importOriginal<typeof import('../src/editor/context')>(),
  capture: () => scenario.snapshot,
}));
vi.mock('../src/ui/toolbar', () => ({
  Toolbar: class {
    root = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ width: 352, height: 42 }) });
    visible = false;
    update = vi.fn();
    focus = vi.fn();
    positioned = vi.fn();
    contains = vi.fn();
    ownsFocus = vi.fn(() => false);
    destroy = vi.fn();
    show() { this.visible = true; }
    hide() { this.visible = false; }
  },
}));

interface Measurement { key: unknown; read(): Position | null; write(position: Position | null): void }

function setup(start: Box = { left: 100, right: 100, top: 100, bottom: 120 }, end: Box = { left: 180, right: 180, top: 100, bottom: 120 }, reverse = false) {
  const window = Object.assign(new EventTarget(), { innerWidth: 600, innerHeight: 500 });
  const document = Object.assign(new EventTarget(), { defaultView: window });
  const dom = Object.assign(new EventTarget(), { ownerDocument: document, isConnected: true });
  const requests = new Map<unknown, Measurement>();
  const view = {
    dom, hasFocus: true,
    scrollDOM: { clientWidth: 600, getBoundingClientRect: () => ({ left: 0, right: 600, top: 0, bottom: 500 }) },
    coordsAtPos: (position: number) => position === 10 ? start : end,
    // CodeMirror replaces an earlier pending measurement with the same key.
    requestMeasure: (request: Measurement) => requests.set(request.key, request),
  } as unknown as EditorView;
  scenario.snapshot = {
    file: { path: 'test.md' } as TFile, path: 'test.md', revision: 0,
    anchor: reverse ? 14 : 10, head: reverse ? 10 : 14, base: 0,
    source: 'word', located: locateFragment('word', 0, 4)!,
  };
  const notify = vi.fn();
  const controller = new EditorController(view, { app: {} as App, store: new PreferencesStore({ load: async () => null, save: async () => {} }), t: key => key, controllers: new Set(), notify });
  const flush = () => {
    const pending = [...requests.values()]; requests.clear();
    for (const request of pending) request.write(request.read());
  };
  return { controller, toolbar: controller['toolbar'], flush, notify };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { scenario.resize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('selection toolbar focus and placement', () => {
  it('preserves a manual focus request when resize measurement replaces it, then focuses only once', () => {
    const { controller, toolbar, flush } = setup();
    expect(controller.show(true)).toBe(true);
    scenario.resize(); flush();
    expect(toolbar.focus).toHaveBeenCalledTimes(1);
    scenario.resize(); flush();
    expect(toolbar.focus).toHaveBeenCalledTimes(1);
    controller.destroy();
  });
  it('does not steal editor focus when shown automatically', () => {
    const { controller, toolbar, flush } = setup();
    expect(controller.show(false)).toBe(true);
    scenario.resize(); flush();
    expect(toolbar.focus).not.toHaveBeenCalled();
    controller.destroy();
  });
  it('keeps a pending manual focus request if automatic display is coalesced into the same frame', () => {
    const { controller, toolbar, flush } = setup();
    controller.show(true); controller.show(false); flush();
    expect(toolbar.focus).toHaveBeenCalledTimes(1);
    controller.destroy();
  });
  it('discards a pending focus request when the selection is closed before layout', () => {
    const { controller, toolbar, flush } = setup();
    controller.show(true); controller.close(false); flush();
    expect(toolbar.focus).not.toHaveBeenCalled();
    expect(toolbar.visible).toBe(false);
    controller.destroy();
  });
  it.each([false, true])('avoids every visual line of a wrapped selection (reverse=%s)', reverse => {
    const { controller, toolbar, flush } = setup({ left: 100, right: 100, top: 100, bottom: 120 }, { left: 450, right: 450, top: 240, bottom: 260 }, reverse);
    controller.show(true); flush();
    expect(toolbar.positioned).toHaveBeenCalledWith(reverse ? 8 : 240, 50);
    controller.destroy();
  });
  it('places below the visible selection when its start has scrolled above the pane', () => {
    const { controller, toolbar, flush } = setup({ left: 100, right: 100, top: -30, bottom: -10 }, { left: 180, right: 180, top: 80, bottom: 100 });
    controller.show(true); flush();
    expect(toolbar.positioned).toHaveBeenCalledWith(8, 108);
    controller.destroy();
  });
  it('hides instead of covering a selection that leaves no vertical space', () => {
    const { controller, toolbar, flush, notify } = setup({ left: 100, right: 100, top: 10, bottom: 30 }, { left: 180, right: 180, top: 460, bottom: 480 });
    controller.show(true); flush();
    expect(toolbar.visible).toBe(false);
    expect(toolbar.focus).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('noSpace');
    controller.destroy();
  });
});
