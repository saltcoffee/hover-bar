import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, MarkdownFileInfo, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { EditorController } from '../src/editor/controller';
import { editorInfoField, Scope as TestScope } from './support/obsidian';
import type { CaptureResult, SelectionSnapshot } from '../src/editor/context';
import { locateFragment } from '../src/formatting/fragment';
import { PreferencesStore } from '../src/settings/store';
import type { Box, Position } from '../src/ui/position';

const scenario = vi.hoisted(() => ({ snapshot: undefined as SelectionSnapshot | undefined, blocked: undefined as CaptureResult | undefined, matches: true, resize: () => {} }));
vi.mock('../src/editor/context', async importOriginal => ({
  ...await importOriginal<typeof import('../src/editor/context')>(),
  capture: () => scenario.blocked ?? { kind: 'ready', snapshot: scenario.snapshot },
  matchesSnapshot: () => scenario.matches,
}));
vi.mock('../src/ui/toolbar', () => ({
  Toolbar: class {
    root = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ width: 352, height: 42 }) });
    visible = false;
    update = vi.fn();
    readLayout = vi.fn(() => ({ fits: true }));
    applyLayout = vi.fn(() => false);
    takeSpaceFeedback = vi.fn(() => false);
    escape = vi.fn();
    focus = vi.fn();
    positioned = vi.fn();
    contains = vi.fn();
    ownsFocus = vi.fn(() => false);
    destroy = vi.fn();
    show = vi.fn(() => { this.visible = true; });
    hide() { this.visible = false; }
  },
}));

interface Measurement { key: unknown; read(): Position | null; write(position: Position | null): void }

function setup(start: Box = { left: 100, right: 100, top: 100, bottom: 120 }, end: Box = { left: 180, right: 180, top: 100, bottom: 120 }, reverse = false) {
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
  const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 600, height: 500 });
  const window = Object.assign(new EventTarget(), { innerWidth: 600, innerHeight: 500, visualViewport: viewport,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const document = Object.assign(new EventTarget(), { defaultView: window });
  const dom = Object.assign(new EventTarget(), { ownerDocument: document, isConnected: true });
  const requests = new Map<unknown, Measurement>();
  const file = { path: 'test.md' } as TFile;
  const state = EditorState.create({ doc: '          word', extensions: [editorInfoField.init(() => ({ file }) as MarkdownFileInfo)] });
  const view = {
    state, dom, hasFocus: true, focus: vi.fn(),
    scrollDOM: { clientWidth: 600, getBoundingClientRect: () => ({ left: 0, right: 600, top: 0, bottom: 500 }) },
    coordsAtPos: (position: number) => position === 10 ? start : end,
    // CodeMirror replaces an earlier pending measurement with the same key.
    requestMeasure: (request: Measurement) => requests.set(request.key, request),
  } as unknown as EditorView;
  scenario.snapshot = {
    file, path: 'test.md', revision: 0,
    anchor: reverse ? 14 : 10, head: reverse ? 10 : 14, base: 0,
    lineLength: 14, source: 'word', located: locateFragment('word', 0, 4)!,
  };
  const notify = vi.fn();
  const store = new PreferencesStore({ load: async () => null, save: async () => {} });
  const keymap = { pushScope: vi.fn(), popScope: vi.fn() };
  const controller = new EditorController(view, { app: { keymap } as unknown as App, store, t: key => key, controllers: new Set(), notify });
  const flush = () => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
    const pending = [...requests.values()]; requests.clear();
    for (const request of pending) request.write(request.read());
  };
  return { controller, toolbar: controller['toolbar'], flush, requests, notify, viewport, dom, document, window, view, store, keymap };
}

beforeEach(() => {
  scenario.blocked = undefined; scenario.matches = true;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { scenario.resize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('selection toolbar focus and placement', () => {
  it('owns the host Escape scope only while the toolbar has focus, and releases it on close', () => {
    const { controller, toolbar, flush, keymap } = setup();
    controller.show(true); flush();
    expect(keymap.pushScope).not.toHaveBeenCalled();
    vi.mocked(toolbar.ownsFocus).mockReturnValue(true);
    toolbar.root.dispatchEvent(new Event('focusin')); toolbar.root.dispatchEvent(new Event('focusin'));
    expect(keymap.pushScope).toHaveBeenCalledTimes(1);
    const scope = controller['scope'] as unknown as TestScope;
    const event = Object.assign(new Event('keydown', { cancelable: true }), { isComposing: false, keyCode: 0 });
    expect(scope.handlers.get('Escape')!(event as unknown as KeyboardEvent)).toBe(false);
    expect(toolbar.escape).toHaveBeenCalledTimes(1);
    controller.close('dismiss'); controller.destroy();
    expect(keymap.popScope).toHaveBeenCalledExactlyOnceWith(scope);
  });
  it('leaves composing Escape alone and releases host key ownership when focus returns to the editor', async () => {
    const { controller, toolbar, flush, keymap } = setup(); controller.show(true); flush();
    vi.mocked(toolbar.ownsFocus).mockReturnValue(true); toolbar.root.dispatchEvent(new Event('focusin'));
    const scope = controller['scope'] as unknown as TestScope;
    const event = Object.assign(new Event('keydown'), { isComposing: true, keyCode: 229 });
    expect(scope.handlers.get('Escape')!(event as unknown as KeyboardEvent)).toBeUndefined();
    expect(toolbar.escape).not.toHaveBeenCalled();
    vi.mocked(toolbar.ownsFocus).mockReturnValue(false); toolbar.root.dispatchEvent(new Event('focusout')); await Promise.resolve();
    expect(keymap.popScope).toHaveBeenCalledTimes(1); expect(toolbar.visible).toBe(true); controller.destroy();
  });
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
    controller.show(true); controller.close('stale'); flush();
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

describe('desktop selection lifecycle', () => {
  it('keeps native context menus inside the toolbar without closing the session', () => {
    const { controller, toolbar, flush, document } = setup();
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
  it('shows after a pointer selection without stealing editor focus', () => {
    const { controller, toolbar, flush } = setup();
    controller.update(select('select.pointer')); flush();
    expect(toolbar.visible).toBe(true); expect(toolbar.show).toHaveBeenCalledWith();
    expect(toolbar.focus).not.toHaveBeenCalled();
    controller.destroy();
  });
  it('waits for a mouse drag to finish before showing the toolbar', () => {
    const { controller, toolbar, flush, dom, window } = setup();
    dom.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    controller.update(select('select.pointer')); flush(); expect(toolbar.visible).toBe(false);
    window.dispatchEvent(new Event('pointerup')); flush();
    expect(toolbar.visible).toBe(true); expect(toolbar.focus).not.toHaveBeenCalled();
    controller.destroy();
  });
  it('does not show after a cancelled mouse drag', () => {
    const { controller, toolbar, flush, dom, window } = setup();
    dom.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    controller.update(select('select.pointer'));
    window.dispatchEvent(new Event('pointercancel')); flush();
    expect(toolbar.visible).toBe(false); controller.destroy();
  });
  it('honors the keyboard selection preference', async () => {
    const { controller, toolbar, flush, store } = setup();
    await store.load();
    controller.update(select('select')); flush();
    expect(toolbar.visible).toBe(false);
    await store.set('keyboard', true); controller.update(select('select')); flush();
    expect(toolbar.visible).toBe(true);
    controller.destroy();
  });
  it('keeps manual access when automatic display is disabled', async () => {
    const { controller, toolbar, flush, dom, window, store } = setup();
    await store.load(); await store.set('automatic', false); await store.set('keyboard', true);
    controller.update(select('select')); flush(); expect(toolbar.visible).toBe(false);
    dom.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    controller.update(select('select.pointer')); window.dispatchEvent(new Event('pointerup')); flush();
    expect(toolbar.visible).toBe(false);
    controller.show(true); flush(); expect(toolbar.visible).toBe(true);
    expect(toolbar.focus).toHaveBeenCalledTimes(1);
    controller.destroy();
  });
  it('ignores programmatic selections even with keyboard selection enabled', async () => {
    const { controller, toolbar, flush, store } = setup();
    await store.load(); await store.set('keyboard', true);
    controller.update(select()); flush(); expect(toolbar.visible).toBe(false);
    controller.destroy();
  });
  it('measures the current pane instead of passing a compact-layout flag', () => {
    const { controller, toolbar, flush, view } = setup();
    Object.defineProperty(view.scrollDOM, 'clientWidth', { value: 380 });
    controller.show(false); flush();
    expect(toolbar.visible).toBe(true); expect(toolbar.show).toHaveBeenCalledWith();
    controller.destroy();
  });
  it('repositions on viewport changes and closes when the selection leaves view', () => {
    const { controller, toolbar, viewport, flush } = setup();
    controller.show(false); flush(); expect(toolbar.positioned).toHaveBeenLastCalledWith(8, 50);
    viewport.offsetTop = 80; viewport.height = 420; viewport.dispatchEvent(new Event('scroll')); flush();
    expect(toolbar.positioned).toHaveBeenLastCalledWith(8, 128);
    viewport.height = 30; viewport.dispatchEvent(new Event('resize')); flush();
    expect(toolbar.visible).toBe(false);
    controller.destroy();
  });
});

describe('diagnosis, cancellation and focus return', () => {
  it.each([
    [{ kind: 'readOnly' }, 'readOnly'], [{ kind: 'composing' }, 'composing'],
    [{ kind: 'multipleSelections' }, 'multipleSelections'], [{ kind: 'emptySelection' }, 'emptySelection'],
    [{ kind: 'multipleLines' }, 'multipleLines'], [{ kind: 'syntaxPending' }, 'syntaxPending'],
    [{ kind: 'protectedSyntax' }, 'protectedSyntax'], [{ kind: 'unsupportedFragment' }, 'unsupported'],
    [{ kind: 'tooLong', stage: 'line' }, 'tooLong'], [{ kind: 'modeDisabled', mode: 'source' }, 'modeDisabled'],
    [{ kind: 'preferences', status: 'conflict' }, 'settingsConflict'],
  ] as const)('keeps automatic rejection silent and reports one manual reason: %s', (reason, key) => {
    const { controller, flush, notify, toolbar } = setup();
    scenario.blocked = { kind: 'blocked', reason };
    expect(controller.show(false)).toBe(false); flush(); expect(notify).not.toHaveBeenCalled();
    expect(controller.show(true)).toBe(false); flush();
    expect(notify).toHaveBeenCalledExactlyOnceWith(key); expect(toolbar.visible).toBe(false);
    controller.destroy();
  });
  it('prioritizes a stale identity over a new formatting restriction on execution', () => {
    const { controller, flush, notify } = setup(); controller.show(true); flush();
    scenario.matches = false; scenario.blocked = { kind: 'blocked', reason: { kind: 'readOnly' } };
    controller['format']('bold'); expect(notify).toHaveBeenCalledExactlyOnceWith('stale');
    controller.destroy();
  });
  it('reports a current restriction when the active document and selection still match', () => {
    const { controller, flush, notify } = setup(); controller.show(true); flush();
    scenario.blocked = { kind: 'blocked', reason: { kind: 'composing' } };
    controller['format']('bold'); expect(notify).toHaveBeenCalledExactlyOnceWith('composing'); controller.destroy();
  });
  it.each(['dismiss', 'linkApplied'] as const)('returns focus after clearing the write snapshot: %s', reason => {
    const { controller, toolbar, flush, view } = setup(); controller.show(true); flush();
    vi.mocked(toolbar.ownsFocus).mockReturnValue(true); Object.defineProperty(view, 'hasFocus', { value: false });
    scenario.blocked = { kind: 'blocked', reason: { kind: 'protectedSyntax' } };
    controller.close(reason);
    expect(controller['current']).toBeNull(); expect(view.focus).toHaveBeenCalledTimes(1);
    controller.close(reason); expect(view.focus).toHaveBeenCalledTimes(1); controller.destroy();
  });
  it.each(['outside', 'windowBlur', 'modeChanged', 'failed', 'destroy'] as const)('does not steal focus for %s', reason => {
    const { controller, toolbar, flush, view } = setup(); controller.show(true); flush();
    vi.mocked(toolbar.ownsFocus).mockReturnValue(true); Object.defineProperty(view, 'hasFocus', { value: false });
    controller.close(reason); expect(view.focus).not.toHaveBeenCalled(); controller.destroy();
  });
  it('does not restore focus to an editor whose file has changed or whose DOM is disconnected', () => {
    for (const change of ['file', 'disconnected']) {
      const { controller, toolbar, flush, view, dom } = setup(); controller.show(true); flush();
      vi.mocked(toolbar.ownsFocus).mockReturnValue(true); Object.defineProperty(view, 'hasFocus', { value: false });
      if (change === 'file') scenario.snapshot!.file.path = 'other.md'; else dom.isConnected = false;
      controller.close('dismiss'); expect(view.focus).not.toHaveBeenCalled(); controller.destroy();
    }
  });
  it('ignores an old measurement without consuming the new session focus request', () => {
    const { controller, toolbar, requests, flush, notify } = setup(); controller.show(true);
    const old = [...requests.values()][0]!; controller.close('stale');
    scenario.snapshot = { ...scenario.snapshot!, revision: 1 }; controller.show(true);
    old.write(old.read()); expect(toolbar.visible).toBe(true); expect(notify).not.toHaveBeenCalled();
    flush(); expect(toolbar.focus).toHaveBeenCalledTimes(1); controller.destroy();
  });
  it('suppresses an explicitly dismissed selection until the user changes it', () => {
    const { controller, toolbar, flush } = setup(); controller.show(false); flush(); controller.close('dismiss');
    expect(controller.show(false)).toBe(false);
    controller.update(select('select.pointer')); flush(); expect(toolbar.visible).toBe(true);
    controller.destroy();
  });
});
