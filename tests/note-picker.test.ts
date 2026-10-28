import { describe, expect, it, vi } from 'vitest';
import { NotePicker } from '../src/ui/note-picker';
import type { NoteChoice, ToolbarActions } from '../src/ui/toolbar-types';

// Only the DOM boundary is replaced. Requests, cancellation and composition use the real picker.
class Element extends EventTarget {
  tagName: string; className = ''; id = ''; type = ''; placeholder = ''; value = '';
  children: Element[] = []; attributes = new Map<string, string>(); private text = '';
  scrollIntoView = vi.fn(); focus = vi.fn();
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.text = ''; this.children = children; }
}

function deferred() {
  let resolve!: (value: readonly NoteChoice[]) => void, reject!: (error: Error) => void;
  const promise = new Promise<readonly NoteChoice[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function keyboard(input: Element, key: string, isComposing = false, type = 'keydown', keyCode = 0) {
  const event = Object.assign(new Event(type, { cancelable: true }), { key, isComposing, keyCode }); input.dispatchEvent(event); return event;
}
function setup(notes: ToolbarActions['notes'] = async () => [{ path: 'target.md', name: 'Target' }]) {
  const panel = new Element('div');
  const actions: ToolbarActions = { notes, format: vi.fn(), explain: vi.fn(), quickLink: vi.fn(), selectNote: vi.fn(), close: vi.fn(), resize: vi.fn() };
  const picker = new NotePicker({ createElement: (tag: string) => new Element(tag) } as unknown as Document,
    panel as unknown as HTMLElement, key => key, actions);
  return { picker, actions, panel, input: panel.children[0]!, list: panel.children[1]! };
}

describe('note picker request and input lifecycle', () => {
  it('shows loading and a real empty state without treating its paragraph as a selected option', async () => {
    const request = deferred(); const { input, list } = setup(() => request.promise);
    expect(list.getAttribute('aria-busy')).toBe('true'); request.resolve([]); await settle();
    expect(list.getAttribute('aria-busy')).toBe('false'); expect(list.textContent).toBe('noNotes');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });
  it.each(['resolve', 'reject'] as const)('ignores an older query that later %ss', async completion => {
    const first = deferred(), second = deferred(); const signals: AbortSignal[] = [];
    const notes = vi.fn((_query: string, signal: AbortSignal) => { signals.push(signal); return signals.length === 1 ? first.promise : second.promise; });
    const { input, list, actions } = setup(notes);
    input.value = 'new'; input.dispatchEvent(new Event('input'));
    expect(signals[0]!.aborted).toBe(true);
    second.resolve([{ path: 'new.md', name: 'New result' }]); await settle();
    const resizes = vi.mocked(actions.resize).mock.calls.length;
    if (completion === 'resolve') first.resolve([{ path: 'old.md', name: 'Old result' }]); else first.reject(Error('Old failure'));
    await settle(); expect(list.textContent).toBe('New resultnew.md');
    expect(vi.mocked(actions.resize).mock.calls.length).toBe(resizes);
    keyboard(input, 'Enter'); expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith('new.md');
  });
  it.each(['resolve', 'reject'] as const)('does not redraw a cancelled picker after a late %s', async completion => {
    const request = deferred(); const { picker, list, actions } = setup(() => request.promise);
    picker.cancel(); const resizes = vi.mocked(actions.resize).mock.calls.length;
    if (completion === 'resolve') request.resolve([{ path: 'old.md', name: 'Old' }]); else request.reject(Error('Late failure'));
    await settle(); expect(list.textContent).toBe('searching');
    expect(vi.mocked(actions.resize).mock.calls.length).toBe(resizes); expect(actions.selectNote).not.toHaveBeenCalled();
  });
  it('keeps the failed search retryable and replaces the error with new results', async () => {
    const notes = vi.fn().mockRejectedValueOnce(Error('Read failure')).mockResolvedValueOnce([{ path: 'target.md', name: 'Target' }]);
    const { list } = setup(notes); await settle();
    expect(list.getAttribute('aria-busy')).toBe('false'); expect(list.textContent).toBe('searchErrorretry');
    list.children[0]!.dispatchEvent(new Event('click')); await settle();
    expect(list.textContent).toBe('Targettarget.md'); expect(notes).toHaveBeenCalledTimes(2);
  });
  it('does not consume composition keys or confirm until the composing Enter has been released', async () => {
    const { input, actions } = setup(); await settle();
    input.dispatchEvent(new Event('compositionstart'));
    expect(keyboard(input, 'Enter', true).defaultPrevented).toBe(false);
    input.dispatchEvent(new Event('compositionend')); keyboard(input, 'Enter');
    expect(actions.selectNote).not.toHaveBeenCalled();
    keyboard(input, 'Enter', false, 'keyup'); keyboard(input, 'Enter');
    expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith('target.md');
  });
  it('lets a new confirmation work after composition was completed without Enter', async () => {
    const { input, actions } = setup(); await settle();
    input.dispatchEvent(new Event('compositionstart')); input.dispatchEvent(new Event('compositionend')); keyboard(input, 'Enter');
    expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith('target.md');
  });
  it('does not confirm when composition ends before its IME Enter keydown', async () => {
    const { input, actions } = setup(); await settle();
    input.dispatchEvent(new Event('compositionstart'));
    input.dispatchEvent(new Event('compositionend'));
    expect(keyboard(input, 'Enter', false, 'keydown', 229).defaultPrevented).toBe(false);
    expect(keyboard(input, 'Enter').defaultPrevented).toBe(false);
    expect(actions.selectNote).not.toHaveBeenCalled(); expect(actions.explain).not.toHaveBeenCalled();
    keyboard(input, 'Enter', false, 'keyup'); keyboard(input, 'Enter');
    expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith('target.md');
  });
  it('leaves an IME navigation key alone before compositionstart is delivered', async () => {
    const { input, actions } = setup(async () => [{ path: 'first.md', name: 'First' }, { path: 'second.md', name: 'Second' }]); await settle();
    expect(keyboard(input, 'ArrowDown', false, 'keydown', 229).defaultPrevented).toBe(false);
    keyboard(input, 'Enter'); expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith('first.md');
  });
  it('explains unavailable targets and leaves native text undo alone', async () => {
    const { input, actions, list } = setup(async () => [{ path: 'target.md', name: 'Target', disabledReason: 'tooLong' }]); await settle();
    expect(list.children[0]!.getAttribute('aria-disabled')).toBe('true');
    keyboard(input, 'Enter'); expect(actions.explain).toHaveBeenCalledExactlyOnceWith('tooLong'); expect(actions.selectNote).not.toHaveBeenCalled();
    expect(keyboard(input, 'z').defaultPrevented).toBe(false);
  });
});
