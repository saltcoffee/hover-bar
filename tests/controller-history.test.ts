import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState, StateEffect, type TransactionSpec } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorController } from '../src/editor/controller';
import * as context from '../src/editor/context';
import { selectionFixture } from './support/selection';

// Keep capture and applyEdit real here; the lifecycle suite mocks capture to isolate its cases.
vi.mock('../src/ui/toolbar', () => ({
  Toolbar: class {
    root = new EventTarget(); visible = false;
    update = vi.fn(); show = vi.fn(() => { this.visible = true; });
    hide() { this.visible = false; }
    ownsFocus() { return false; }
    destroy() {}
  },
}));
const controllers: EditorController[] = [];
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

async function setup(source = 'before text after') {
  const from = source.indexOf('text'), fixture = await selectionFixture(source, { from, to: from + 4 });
  const window = Object.assign(new EventTarget(), { cancelAnimationFrame: vi.fn() });
  const document = Object.assign(new EventTarget(), { defaultView: window });
  const dom = Object.assign(new EventTarget(), { ownerDocument: document, isConnected: true });
  Object.assign(fixture.view, { dom, hasFocus: true, focus: vi.fn(), requestMeasure: vi.fn() });
  Object.assign(fixture.app, { keymap: { pushScope: vi.fn(), popScope: vi.fn() } });
  const originalDispatch = fixture.view.dispatch.bind(fixture.view);
  const dispatch = vi.fn((spec: TransactionSpec) => {
    originalDispatch(spec);
    // Supply the parse progress normally provided by the host view's parser worker.
    ensureSyntaxTree(fixture.view.state, fixture.view.state.doc.length, 200);
  });
  Object.assign(fixture.view, { dispatch });
  const notify = vi.fn();
  const controller = new EditorController(fixture.view, { app: fixture.app, store: fixture.store,
    t: key => key, controllers: new Set(), notify }); controllers.push(controller);
  expect(controller.show(true)).toBe(true);
  const originalRecord = fixture.store.recordColorUse.bind(fixture.store), record = vi.spyOn(fixture.store, 'recordColorUse');
  return { ...fixture, controller, toolbar: controller['toolbar'], dispatch, record, originalRecord, notify };
}

describe('color use after editor commit', () => {
  it.each(['foreground', 'background'] as const)('records %s only after the document and selection have been verified', async kind => {
    const fixture = await setup(), { controller, view, store, dispatch, record, originalRecord } = fixture;
    record.mockImplementation((type, color) => {
      expect(view.state.doc.toString()).toBe(`before <span style="${kind === 'foreground' ? 'color' : 'background-color'}:#aabbcc">text</span> after`);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('text');
      expect(controller['current']?.revision).toBe(view.state.field(context.revisionField));
      originalRecord(type, color);
    });
    expect(controller['format'](kind, '#aabbcc')).toEqual({ kind: 'applied' });
    expect(record).toHaveBeenCalledExactlyOnceWith(kind, '#aabbcc');
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]!);
    expect(store.history[kind]).toEqual(['#aabbcc']); await settle();
  });
  it('records a verified edit even if recapturing the edited selection closes the session', async () => {
    const { controller, view, store, record, toolbar } = await setup();
    const original = context.capture, capture = vi.spyOn(context, 'capture');
    capture.mockImplementationOnce((...args) => original(...args));
    capture.mockReturnValueOnce({ kind: 'blocked', reason: { kind: 'readOnly' } });
    expect(controller['format']('foreground', '#aabbcc')).toEqual({ kind: 'closed' });
    expect(view.state.doc.toString()).toContain('color:#aabbcc');
    expect(controller['current']).toBeNull(); expect(toolbar.visible).toBe(false);
    expect(record).toHaveBeenCalledExactlyOnceWith('foreground', '#aabbcc'); expect(store.history.foreground).toEqual(['#aabbcc']);
  });
  it.each([
    ['same foreground', 'before <span style="color:#aabbcc">text</span> after', 'foreground', '#aabbcc', 'unchanged'],
    ['same background', 'before <span style="background-color:#aabbcc">text</span> after', 'background', '#aabbcc', 'unchanged'],
    ['remove foreground', 'before <span style="color:#aabbcc">text</span> after', 'foreground', undefined, 'applied'],
    ['remove background', 'before <span style="background-color:#aabbcc">text</span> after', 'background', undefined, 'applied'],
    ['clear colors', 'before <span style="color:#aabbcc">text</span> after', 'clearColors', undefined, 'applied'],
    ['basic format', 'before text after', 'bold', undefined, 'applied'],
    ['unsupported code color', 'before `text` after', 'foreground', '#aabbcc', 'rejected'],
    ['noncanonical color', 'before text after', 'foreground', '#ABC', 'rejected'],
  ] as const)('does not record %s', async (_name, source, action, color, outcome) => {
    const { controller, record, store, view, dispatch } = await setup(source);
    expect(controller['format'](action, color)).toEqual({ kind: outcome });
    expect(record).not.toHaveBeenCalled(); expect(store.history).toEqual({ foreground: [], background: [] });
    if (outcome !== 'applied') { expect(view.state.doc.toString()).toBe(source); expect(dispatch).not.toHaveBeenCalled(); }
  });
  it.each(['filtered', 'selectionChanged'] as const)('does not record a %s transaction that fails post-dispatch verification', async failure => {
    const { controller, view, record, store } = await setup();
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.transactionFilter.of(transaction => {
      if (!transaction.docChanged) return transaction;
      return failure === 'filtered' ? [] : [transaction, { selection: EditorSelection.cursor(0) }];
    })) });
    expect(controller['format']('foreground', '#aabbcc')).toEqual({ kind: 'closed' });
    expect(record).not.toHaveBeenCalled(); expect(store.history.foreground).toEqual([]);
    expect(view.state.doc.toString()).toBe(failure === 'filtered' ? 'before text after' : 'before <span style="color:#aabbcc">text</span> after');
  });
  it('refreshes history using the current snapshot without capture, show, focus or editor transactions', async () => {
    const { controller, toolbar, view, store, dispatch } = await setup();
    const capture = vi.spyOn(context, 'capture'), show = vi.spyOn(controller, 'show'), close = vi.spyOn(controller, 'close');
    const snapshot = controller['current'], state = view.state; vi.mocked(toolbar.update).mockClear();
    store.recordColorUse('foreground', '#aabbcc'); controller.refreshHistory(); await settle();
    expect(capture).not.toHaveBeenCalled(); expect(show).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(view.focus).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled(); expect(controller['current']).toBe(snapshot); expect(view.state).toBe(state);
    expect(toolbar.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recent: expect.objectContaining({ foreground: [expect.objectContaining({ color: '#aabbcc' })] }) }));
  });
});
