import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, TFolder, type App, type MarkdownFileInfo } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { EditorController } from '../src/editor/controller';
import { metadataSignature, type MetadataResult, type NoteMetadataEntry, type NoteMetadataSource } from '../src/editor/note-metadata';
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
    isComposing = vi.fn(() => false);
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
    anchor: reverse ? 14 : 10, head: reverse ? 10 : 14, selectionLength: 4,
    lines: [{ lineFrom: 0, base: 10, source: 'word', lineLength: 14, located: locateFragment('word', 0, 4)! }],
  };
  const notify = vi.fn();
  const store = new PreferencesStore({ load: async () => null, save: async () => {} });
  const keymap = { pushScope: vi.fn(), popScope: vi.fn() };
  const metadata: NoteMetadataSource = {
    currentEpoch: 0, canReuseSnapshot: () => false, subscribe: () => () => {}, recordFor: () => null,
    collect: async () => ({ kind: 'pending' }), destroy: () => {},
  };
  const controller = new EditorController(view, { app: { keymap } as unknown as App, store, t: key => key, metadata, controllers: new Set(), notify });
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
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: false });
    expect(scope.handlers.get('Escape')!(event as unknown as KeyboardEvent)).toBe(false);
    expect(toolbar.escape).toHaveBeenCalledTimes(1);
    controller.close('dismiss'); controller.destroy();
    expect(keymap.popScope).toHaveBeenCalledExactlyOnceWith(scope);
  });
  it('leaves composing Escape alone and releases host key ownership when focus returns to the editor', async () => {
    const { controller, toolbar, flush, keymap } = setup(); controller.show(true); flush();
    vi.mocked(toolbar.ownsFocus).mockReturnValue(true); toolbar.root.dispatchEvent(new Event('focusin'));
    const scope = controller['scope'] as unknown as TestScope;
    const composingEvent = Object.assign(new Event('keydown'), { key: 'Escape', isComposing: true });
    expect(scope.handlers.get('Escape')!(composingEvent as unknown as KeyboardEvent)).toBeUndefined();
    const processEvent = Object.assign(new Event('keydown'), { key: 'Process', isComposing: false });
    expect(scope.handlers.get('Escape')!(processEvent as unknown as KeyboardEvent)).toBeUndefined();
    vi.mocked(toolbar.isComposing).mockReturnValueOnce(true);
    const toolbarComposingEvent = Object.assign(new Event('keydown'), { key: 'Escape', isComposing: false });
    expect(scope.handlers.get('Escape')!(toolbarComposingEvent as unknown as KeyboardEvent)).toBeUndefined();
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
  it('anchors on the visible endpoint when a long selection head is off-screen', () => {
    const { controller, toolbar, flush, view } = setup();
    Object.defineProperty(view, 'coordsAtPos', { value: (position: number) => position === 14 ? null : { left: 100, right: 100, top: 100, bottom: 120 } });
    controller.show(true); flush();
    expect(toolbar.visible).toBe(true);
    expect(toolbar.positioned).toHaveBeenCalledWith(8, 50);
    controller.destroy();
  });
  it('still places the toolbar when both endpoints are off-screen', () => {
    const { controller, toolbar, flush, view } = setup();
    Object.defineProperty(view, 'coordsAtPos', { value: () => null });
    controller.show(true); flush();
    expect(toolbar.visible).toBe(true);
    expect(toolbar.positioned).toHaveBeenCalledWith(8, 16);
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
    [{ kind: 'tooManyLines' }, 'tooManyLines'], [{ kind: 'multiLineStructure' }, 'multiLineStructure'],
    [{ kind: 'multiLineUnsafe' }, 'multiLineUnsafe'], [{ kind: 'syntaxPending' }, 'syntaxPending'],
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

function noteEntry(path: string, aliases: readonly string[] = []): NoteMetadataEntry {
  const name = path.split('/').pop()!.replace(/\.md$/, '');
  const record = { path, name, aliases };
  const file = { path, basename: name, extension: 'md' } as TFile;
  return { record, file, signature: metadataSignature(record) };
}

function noteSearchSetup(initialEntries: readonly NoteMetadataEntry[]) {
  const base = setup();
  let entries = [...initialEntries];
  let epoch = 0;
  let ready = true;
  const listeners = new Set<() => void>();
  const collect = vi.fn(async (_signal: AbortSignal, isValid: () => boolean): Promise<MetadataResult> => {
    if (!isValid()) return { kind: 'cancelled' };
    if (!ready) return { kind: 'pending' };
    return { kind: 'ready', epoch, entries: [...entries] };
  });
  const metadata: NoteMetadataSource = {
    get currentEpoch() { return epoch; },
    canReuseSnapshot: (targetEpoch: number) => ready && epoch === targetEpoch,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    recordFor: file => entries.find(item => item.file === file)?.record ?? null,
    collect,
    destroy: () => { listeners.clear(); },
  };
  const toolbarNotePicker = vi.fn();
  const app = {
    keymap: base.keymap,
    vault: { getFileByPath: (path: string) => entries.find(item => item.record.path === path)?.file ?? null },
    metadataCache: {
      fileToLinktext: (file: TFile) => file.basename,
      getFirstLinkpathDest: (target: string) => entries.find(item => item.record.name === target)?.file ?? null,
    },
  } as unknown as App;
  const controller = new EditorController(base.view, {
    app, store: base.store, t: key => key, metadata, controllers: new Set(), notify: base.notify,
  });
  Object.assign(controller['toolbar'], { notePicker: toolbarNotePicker, refreshNotes: vi.fn(() => true) });
  controller.show(true);
  base.flush();
  return {
    ...base, controller, collect, toolbarNotePicker,
    setEntries: (next: readonly NoteMetadataEntry[]) => { entries = [...next]; },
    setReady: (value: boolean) => { ready = value; },
    bumpEpoch: () => { epoch++; for (const listener of listeners) listener(); },
  };
}

describe('picker snapshot reuse and quick-link freshness', () => {
  it('reuses a ready snapshot within the same session and epoch, then collects again after invalidation or cancel', async () => {
    const entries = [noteEntry('a/Alpha.md', ['TermA']), noteEntry('b/Beta.md', ['TermB'])];
    const { controller, collect, bumpEpoch } = noteSearchSetup(entries);
    const first = await controller['notes']('', new AbortController().signal);
    expect(first).toMatchObject({ kind: 'ready', matchedCount: 2 });
    expect(collect).toHaveBeenCalledTimes(1);

    const second = await controller['notes']('TermB', new AbortController().signal);
    expect(second).toMatchObject({ kind: 'ready', matchedCount: 1, items: [{ path: 'b/Beta.md' }] });
    expect(collect).toHaveBeenCalledTimes(1);

    bumpEpoch();
    const afterInvalidation = await controller['notes']('TermA', new AbortController().signal);
    expect(afterInvalidation).toMatchObject({ kind: 'ready', matchedCount: 1, items: [{ path: 'a/Alpha.md' }] });
    expect(collect).toHaveBeenCalledTimes(2);

    controller.cancelNoteRequests();
    await controller['notes']('', new AbortController().signal);
    expect(collect).toHaveBeenCalledTimes(3);
    controller.destroy();
  });

  it('never caches non-ready responses and recovers on retry', async () => {
    const entries = [noteEntry('a/Alpha.md')];
    const { controller, collect, setReady } = noteSearchSetup(entries);
    setReady(false);
    await expect(controller['notes']('Alpha', new AbortController().signal)).resolves.toEqual({ kind: 'pending' });
    setReady(true);
    const recovered = await controller['notes']('Alpha', new AbortController().signal);
    expect(recovered).toMatchObject({ kind: 'ready', matchedCount: 1 });
    expect(collect).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  it('prevents a stale concurrent collect from publishing over a newer epoch', async () => {
    const entries = [noteEntry('a/Alpha.md')];
    const { controller, collect, bumpEpoch } = noteSearchSetup(entries);
    let release!: (value: MetadataResult) => void;
    collect.mockImplementationOnce(() => new Promise<MetadataResult>(resolve => { release = resolve; }));
    const stalePromise = controller['notes']('Alpha', new AbortController().signal);
    bumpEpoch();
    release({ kind: 'ready', epoch: 0, entries });
    await expect(stalePromise).resolves.toEqual({ kind: 'stale' });
    await controller['notes']('Alpha', new AbortController().signal);
    expect(collect).toHaveBeenCalledTimes(2);

    // Concurrent older request resolving after a newer epoch-1 request already cached must not overwrite it
    let releaseOlder!: (value: MetadataResult) => void;
    collect.mockImplementationOnce(() => new Promise<MetadataResult>(resolve => { releaseOlder = resolve; }));
    bumpEpoch();
    const older = controller['notes']('Alpha', new AbortController().signal);
    bumpEpoch();
    const newer = await controller['notes']('Alpha', new AbortController().signal);
    expect(newer).toMatchObject({ kind: 'ready', matchedCount: 1 });
    releaseOlder({ kind: 'ready', epoch: 2, entries });
    await expect(older).resolves.toEqual({ kind: 'cancelled' });
    // Subsequent query at current epoch (3) still hits the epoch-3 snapshot without another collect
    await controller['notes']('Alpha', new AbortController().signal);
    expect(collect).toHaveBeenCalledTimes(4);
    controller.destroy();
  });

  it('always collects fresh metadata for quick-link even after warming the picker snapshot, and preserves conflicts beyond 50 matches', async () => {
    const many = Array.from({ length: 55 }, (_, i) => noteEntry(`notes/${String(i).padStart(2, '0')}.md`, i >= 53 ? ['word'] : []));
    const { controller, collect, setReady, toolbarNotePicker } = noteSearchSetup(many);
    // Warm picker snapshot at current epoch
    const warmed = await controller['notes']('word', new AbortController().signal);
    expect(warmed).toMatchObject({ kind: 'ready', matchedCount: 2 });
    expect(collect).toHaveBeenCalledTimes(1);

    // Quick-link must still detect the conflict past 50 files via a fresh collect
    await controller['runQuickLink']();
    expect(collect).toHaveBeenCalledTimes(2);
    expect(toolbarNotePicker).toHaveBeenCalledWith('word', 'conflict');

    // Warm snapshot again, then make metadata pending and invoke quick-link: must NOT write or reuse snapshot
    await controller['notes']('word', new AbortController().signal);
    setReady(false);
    toolbarNotePicker.mockClear();
    await controller['runQuickLink']();
    expect(collect).toHaveBeenCalledTimes(4);
    expect(toolbarNotePicker).toHaveBeenCalledWith('word', undefined);
    controller.destroy();
  });

  it('shares a single in-flight collect across rapid sequential picker queries and publishes only the latest query', async () => {
    const entries = [noteEntry('a/Alpha.md', ['TermA']), noteEntry('b/Beta.md', ['TermB'])];
    const { controller, collect } = noteSearchSetup(entries);
    let release!: (value: MetadataResult) => void;
    collect.mockImplementationOnce(() => new Promise<MetadataResult>(resolve => { release = resolve; }));
    const reqA = controller['notes']('TermA', new AbortController().signal);
    const reqB = controller['notes']('TermB', new AbortController().signal);
    expect(collect).toHaveBeenCalledTimes(1);
    release({ kind: 'ready', epoch: 0, entries });
    await expect(reqA).resolves.toEqual({ kind: 'cancelled' });
    await expect(reqB).resolves.toMatchObject({ kind: 'ready', matchedCount: 1, items: [{ path: 'b/Beta.md' }] });
    expect(controller['noteEvidence']?.entries.has('b/Beta.md')).toBe(true);
    expect(controller['noteEvidence']?.entries.has('a/Alpha.md')).toBe(false);
    controller.destroy();
  });

  it('prevents an older in-flight collect from clearing a newer epoch collect when metadata changes mid-flight', async () => {
    const entries = [noteEntry('a/Alpha.md')];
    const { controller, collect, bumpEpoch } = noteSearchSetup(entries);
    let releaseA!: (value: MetadataResult) => void;
    let releaseB!: (value: MetadataResult) => void;
    collect
      .mockImplementationOnce(() => new Promise<MetadataResult>(resolve => { releaseA = resolve; }))
      .mockImplementationOnce(() => new Promise<MetadataResult>(resolve => { releaseB = resolve; }));
    const reqA = controller['notes']('Alpha', new AbortController().signal);
    bumpEpoch();
    const reqB = controller['notes']('Alpha', new AbortController().signal);
    const inflightB = controller['pickerCollect'];
    expect(inflightB).not.toBeNull();
    releaseA({ kind: 'ready', epoch: 0, entries });
    await expect(reqA).resolves.toEqual({ kind: 'cancelled' });
    expect(controller['pickerCollect']).toBe(inflightB);
    releaseB({ kind: 'ready', epoch: 1, entries });
    await expect(reqB).resolves.toMatchObject({ kind: 'ready', matchedCount: 1 });
    controller.destroy();
  });

  it('prevents a superseded quick-link from editing or opening the picker once a picker search starts', async () => {
    const entries = [noteEntry('a/word.md')];
    const { controller, collect, toolbarNotePicker, view } = noteSearchSetup(entries);
    let releaseQuick!: (value: MetadataResult) => void;
    collect
      .mockImplementationOnce(() => new Promise<MetadataResult>(resolve => { releaseQuick = resolve; }))
      .mockImplementationOnce(async () => ({ kind: 'ready', epoch: 0, entries }));
    const quick = controller['runQuickLink']();
    const picker = await controller['notes']('word', new AbortController().signal);
    expect(picker).toMatchObject({ kind: 'ready', matchedCount: 1 });
    releaseQuick({ kind: 'ready', epoch: 0, entries });
    await quick;
    expect(toolbarNotePicker).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('          word');
    controller.destroy();
  });

  it('cancels an in-flight picker collect when quick-link starts', async () => {
    const entries = [noteEntry('a/word.md')];
    const { controller, collect, toolbarNotePicker } = noteSearchSetup(entries);
    let releasePicker!: (value: MetadataResult) => void;
    collect
      .mockImplementationOnce(() => new Promise<MetadataResult>(resolve => { releasePicker = resolve; }))
      .mockImplementationOnce(async () => ({ kind: 'ready', epoch: 0, entries: [...entries, noteEntry('b/word.md')] }));
    const picker = controller['notes']('word', new AbortController().signal);
    await controller['runQuickLink']();
    releasePicker({ kind: 'ready', epoch: 0, entries });
    await expect(picker).resolves.toEqual({ kind: 'cancelled' });
    expect(controller['noteEvidence']).toBeNull();
    expect(toolbarNotePicker).toHaveBeenCalledWith('word', 'conflict');
    controller.destroy();
  });

  it.each(['missing', 'error'])('refreshes the original picker after a superseding quick-link has a %s resolution', async resolution => {
    const entries = [noteEntry('a/Target.md', ['word'])];
    const { controller, collect, notify, view, toolbarNotePicker } = noteSearchSetup(entries);
    const refreshNotes = vi.spyOn(controller['toolbar'], 'refreshNotes');
    vi.spyOn(controller['host'].app.metadataCache, 'getFirstLinkpathDest').mockImplementation(() => {
      if (resolution === 'error') throw Error('lookup failed');
      return null;
    });
    let releasePicker!: (result: MetadataResult) => void;
    collect.mockImplementationOnce(() => new Promise(resolve => { releasePicker = resolve; }));
    const picker = controller['notes']('Target', new AbortController().signal);
    await controller['runQuickLink']();
    releasePicker({ kind: 'ready', epoch: 0, entries });
    await expect(picker).resolves.toEqual({ kind: 'cancelled' });
    expect(notify).toHaveBeenCalledWith('invalidLink');
    expect(refreshNotes).toHaveBeenCalledTimes(1);
    expect(toolbarNotePicker).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('          word');
    controller.destroy();
  });

  it('coalesces multiple metadata notifications in the same turn into one picker refresh and cancels queued refresh on cancelNoteRequests', async () => {
    const entries = [noteEntry('a/Alpha.md')];
    const { controller, bumpEpoch } = noteSearchSetup(entries);
    const refreshNotes = (controller['toolbar'] as unknown as { refreshNotes: ReturnType<typeof vi.fn> }).refreshNotes;
    bumpEpoch();
    bumpEpoch();
    bumpEpoch();
    expect(refreshNotes).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(refreshNotes).toHaveBeenCalledTimes(1);

    refreshNotes.mockClear();
    bumpEpoch();
    controller.cancelNoteRequests();
    await Promise.resolve();
    expect(refreshNotes).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('cleans up pickerCollect when collect rejects and allows a subsequent retry', async () => {
    const entries = [noteEntry('a/Alpha.md')];
    const { controller, collect } = noteSearchSetup(entries);
    let rejectCollect!: (error: Error) => void;
    collect
      .mockImplementationOnce(() => new Promise<MetadataResult>((_resolve, reject) => { rejectCollect = reject; }))
      .mockImplementationOnce(async () => ({ kind: 'ready', epoch: 0, entries }));
    const failed = controller['notes']('Alpha', new AbortController().signal);
    expect(controller['pickerCollect']).not.toBeNull();
    rejectCollect(Error('Vault read error'));
    await expect(failed).rejects.toThrow('Vault read error');
    expect(controller['pickerCollect']).toBeNull();
    await expect(controller['notes']('Alpha', new AbortController().signal)).resolves.toMatchObject({ kind: 'ready', matchedCount: 1 });
    controller.destroy();
  });

  it('closes the active session on ancestor folder rename/delete or same-path file replacement without closing on sibling prefixes', () => {
    const { controller, toolbar, flush } = setup();
    const sourceFile = Object.assign(new TFile(), { path: 'notes/test.md', basename: 'test', extension: 'md' });
    scenario.snapshot = { ...scenario.snapshot!, file: sourceFile, path: 'notes/test.md' };
    controller.show(true); flush();
    expect(toolbar.visible).toBe(true);

    // Sibling folder prefix must NOT close the session
    const siblingFolder = Object.assign(new TFolder(), { path: 'notes-old', name: 'notes-old', children: [] });
    controller.handleExternalFileChange(siblingFolder, 'notes-backup');
    expect(toolbar.visible).toBe(true);

    // Ancestor folder rename closes the session
    const renamedFolder = Object.assign(new TFolder(), { path: 'archive', name: 'archive', children: [] });
    controller.handleExternalFileChange(renamedFolder, 'notes');
    expect(toolbar.visible).toBe(false);

    // Reopen and verify ancestor folder delete closes the session
    controller.show(true); flush();
    expect(toolbar.visible).toBe(true);
    const deletedFolder = Object.assign(new TFolder(), { path: 'notes', name: 'notes', children: [] });
    controller.handleExternalFileChange(deletedFolder);
    expect(toolbar.visible).toBe(false);

    // Reopen and verify same-path new TFile create closes the session, while same instance does not
    controller.show(true); flush();
    expect(toolbar.visible).toBe(true);
    controller.handleExternalFileCreate(sourceFile);
    expect(toolbar.visible).toBe(true);
    const replacedFile = Object.assign(new TFile(), { path: 'notes/test.md', basename: 'test', extension: 'md' });
    controller.handleExternalFileCreate(replacedFile);
    expect(toolbar.visible).toBe(false);
    controller.destroy();
  });
});
