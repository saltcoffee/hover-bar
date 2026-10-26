import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { Platform } from './support/obsidian';
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
    expanded = false;
    update = vi.fn();
    focus = vi.fn();
    positioned = vi.fn();
    constrain = vi.fn(() => false);
    contains = vi.fn();
    ownsFocus = vi.fn(() => false);
    destroy = vi.fn();
    show = vi.fn(() => { this.visible = true; });
    hide() { this.visible = false; }
  },
}));

type Layout = { bounds: Box; position: Position | null } | null;
interface Measurement { key: unknown; read(): Layout; write(position: Layout): void }

function setup(start: Box = { left: 100, right: 100, top: 100, bottom: 120 }, end: Box = { left: 180, right: 180, top: 100, bottom: 120 }, reverse = false, mobile = false) {
  Platform.isMobile = mobile;
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
  const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 600, height: 500 });
  const window = Object.assign(new EventTarget(), { innerWidth: 600, innerHeight: 500, visualViewport: viewport,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
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
  const store = new PreferencesStore({ load: async () => null, save: async () => {} });
  const controller = new EditorController(view, { app: {} as App, store, t: key => key, controllers: new Set(), notify });
  const flush = () => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
    const pending = [...requests.values()]; requests.clear();
    for (const request of pending) request.write(request.read());
  };
  return { controller, toolbar: controller['toolbar'], flush, notify, viewport, dom, document, store };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { scenario.resize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { vi.unstubAllGlobals(); Platform.isMobile = false; });

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

function select(userEvent?: string): ViewUpdate {
  const state = EditorState.create({ doc: 'word' });
  const transaction = state.update({ selection: { anchor: 0, head: 4 }, userEvent });
  return { startState: state, state: transaction.state, transactions: [transaction], selectionSet: true, docChanged: false } as unknown as ViewUpdate;
}

describe('touch selection lifecycle', () => {
  it.each([false, true])('keeps native context menus inside the toolbar without closing the session (mobile=%s)', mobile => {
    const { controller, toolbar, flush, document } = setup(undefined, undefined, false, mobile);
    controller.show(false); flush();
    vi.mocked(toolbar.contains).mockReturnValue(true);
    const menu = new Event('contextmenu', { cancelable: true }); document.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false); expect(toolbar.visible).toBe(true);
    controller.destroy();
  });
  it('still closes for a context menu outside the toolbar', () => {
    const { controller, toolbar, flush, document } = setup();
    controller.show(false); flush(); document.dispatchEvent(new Event('contextmenu'));
    expect(toolbar.visible).toBe(false); controller.destroy();
  });
  it('shows for native mobile select transactions without enabling keyboard selection', () => {
    const { controller, toolbar, flush } = setup(undefined, undefined, false, true);
    controller.update(select('select')); flush();
    expect(toolbar.visible).toBe(true); expect(toolbar.show).toHaveBeenCalledWith(false, true);
    expect(toolbar.focus).not.toHaveBeenCalled();
    controller.destroy();
  });
  it('recognizes touch on desktop tablets and preserves native context menus', () => {
    const { controller, toolbar, flush, dom, document } = setup();
    dom.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'touch', button: 0 }));
    controller.update(select('select')); flush();
    expect(toolbar.show).toHaveBeenCalledWith(false, true);
    const menu = new Event('contextmenu', { cancelable: true });
    menu.composedPath = () => [dom, document]; document.dispatchEvent(menu); flush();
    expect(menu.defaultPrevented).toBe(false); expect(toolbar.visible).toBe(true);
    controller.destroy();
  });
  it('still honors automatic and hardware-keyboard preferences on mobile', async () => {
    const { controller, toolbar, flush, dom, store } = setup(undefined, undefined, false, true);
    await store.load();
    dom.dispatchEvent(new Event('keydown')); controller.update(select('select')); flush();
    expect(toolbar.visible).toBe(false);
    await store.set('keyboard', true); controller.update(select('select')); flush();
    expect(toolbar.visible).toBe(true);
    controller.close(false); await store.set('automatic', false);
    dom.dispatchEvent(new Event('touchstart')); controller.update(select('select')); flush();
    expect(toolbar.visible).toBe(false);
    controller.destroy();
  });
  it('ignores programmatic selections and keeps desktop keyboard behavior unchanged', () => {
    for (const mobile of [false, true]) {
      const { controller, toolbar, flush } = setup(undefined, undefined, false, mobile);
      controller.update(select()); flush(); expect(toolbar.visible).toBe(false);
      if (!mobile) { controller.update(select('select')); flush(); expect(toolbar.visible).toBe(false); }
      controller.destroy();
    }
  });
  it('follows the visual viewport when the keyboard opens, pans and closes', () => {
    const { controller, toolbar, viewport, flush } = setup(undefined, undefined, false, true);
    controller.show(false); flush(); expect(toolbar.positioned).toHaveBeenLastCalledWith(124, 450);
    viewport.height = 280; viewport.dispatchEvent(new Event('resize')); flush();
    expect(toolbar.positioned).toHaveBeenLastCalledWith(124, 230);
    viewport.offsetTop = 20; viewport.dispatchEvent(new Event('scroll')); flush();
    expect(toolbar.positioned).toHaveBeenLastCalledWith(124, 250);
    viewport.height = 480; viewport.dispatchEvent(new Event('resize')); flush();
    expect(toolbar.positioned).toHaveBeenLastCalledWith(124, 450);
    controller.destroy();
  });
  it('remeasures constrained touch panels without losing a pending manual focus request', () => {
    const { controller, toolbar, flush } = setup(undefined, undefined, false, true);
    vi.mocked(toolbar.constrain).mockReturnValueOnce(true).mockReturnValue(false);
    controller.show(true); flush(); expect(toolbar.focus).not.toHaveBeenCalled();
    flush(); expect(toolbar.focus).toHaveBeenCalledTimes(1);
    controller.destroy();
  });
  it('keeps expanded panels docked when the visible selection leaves no room for a full palette', () => {
    const { controller, toolbar, viewport, flush } = setup({ left: 100, right: 100, top: 100, bottom: 120 }, { left: 180, right: 180, top: 100, bottom: 120 }, false, true);
    Object.defineProperty(toolbar, 'expanded', { value: true });
    vi.spyOn(toolbar.root, 'getBoundingClientRect').mockReturnValue({ width: 352, height: 230 } as DOMRect);
    viewport.height = 300; controller.show(false); flush();
    expect(toolbar.visible).toBe(true); expect(toolbar.positioned).toHaveBeenLastCalledWith(124, 62);
    controller.destroy();
  });
  it('keeps a focused search panel usable when the keyboard covers the original text', () => {
    const { controller, toolbar, viewport, flush } = setup({ left: 100, right: 100, top: 400, bottom: 420 }, { left: 180, right: 180, top: 400, bottom: 420 }, false, true);
    controller.show(false); flush();
    vi.mocked(toolbar.ownsFocus).mockReturnValue(true);
    viewport.height = 280; viewport.dispatchEvent(new Event('resize')); flush();
    expect(toolbar.visible).toBe(true); expect(toolbar.positioned).toHaveBeenLastCalledWith(124, 230);
    controller.destroy();
    viewport.dispatchEvent(new Event('resize')); flush(); expect(toolbar.visible).toBe(false);
  });
});
