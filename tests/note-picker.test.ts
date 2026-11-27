import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotePicker, type NotePickerOptions } from '../src/ui/note-picker';
import type { NoteChoice, NoteSearchResult, ToolbarActions } from '../src/ui/toolbar-types';

afterEach(() => { vi.useRealTimers(); });

// Only the DOM boundary is replaced. Requests, cancellation and composition use the real picker.
class Doc {
  activeElement: Element | null = null;
  readonly defaultView = {
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
  };
}

class Element extends EventTarget {
  tagName: string; className = ''; id = ''; type = ''; placeholder = ''; value = ''; hidden = false;
  children: Element[] = []; attributes = new Map<string, string>(); private text = '';
  scrollIntoView = vi.fn();
  focus = vi.fn(() => { this.ownerDocument.activeElement = this; });
  constructor(tag: string, readonly ownerDocument: Doc = new Doc()) { super(); this.tagName = tag.toUpperCase(); }
  set textContent(value: string) {
    if (this.contains(this.ownerDocument.activeElement) && this.ownerDocument.activeElement !== this) {
      this.ownerDocument.activeElement = null;
    }
    this.text = value; this.children = [];
  }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  contains(node: Element | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) {
    if (this.contains(this.ownerDocument.activeElement) && this.ownerDocument.activeElement !== this) {
      this.ownerDocument.activeElement = null;
    }
    this.text = ''; this.children = children;
  }
  createEl(tag: string, options?: { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null>; type?: string; placeholder?: string } | string) {
    const child = new Element(tag, this.ownerDocument);
    if (typeof options === 'string') child.className = options;
    else if (options) {
      if (options.cls) child.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
      if (options.text !== undefined) child.textContent = options.text;
      if (options.type !== undefined) child.type = options.type;
      if (options.placeholder !== undefined) child.placeholder = options.placeholder;
      if (options.attr) for (const [key, value] of Object.entries(options.attr)) if (value !== null) child.setAttribute(key, String(value));
    }
    this.append(child);
    return child;
  }
  createDiv(options?: Parameters<Element['createEl']>[1]) { return this.createEl('div', options); }
  createSpan(options?: Parameters<Element['createEl']>[1]) { return this.createEl('span', options); }
}

function ready(items: readonly NoteChoice[], resultId = 'r1', hasMore = false): NoteSearchResult {
  return { kind: 'ready', resultId, items, matchedCount: items.length, hasMore };
}
function deferred() {
  let resolve!: (value: NoteSearchResult) => void, reject!: (error: Error) => void;
  const promise = new Promise<NoteSearchResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function keyboard(input: Element, key: string, isComposing = false, type = 'keydown', code = key, repeat = false) {
  const event = Object.assign(new Event(type, { cancelable: true }), { key, isComposing, code, repeat }); input.dispatchEvent(event); return event;
}
function setup(notes: ToolbarActions['notes'] = async () => ready([{ path: 'target.md', name: 'Target' }]), options: NotePickerOptions = {}) {
  const panel = new Element('div');
  const actions: ToolbarActions = {
    notes, format: vi.fn(), explain: vi.fn(), quickLink: vi.fn(), selectNote: vi.fn(), cancelNoteRequests: vi.fn(), close: vi.fn(), resize: vi.fn(),
  };
  const picker = new NotePicker(panel as unknown as HTMLElement, key => key, actions, options);
  return { picker, actions, panel, input: panel.children[0]!, list: panel.children[1]! };
}

describe('note picker request and input lifecycle', () => {
  it('shows loading and a real empty state without treating its paragraph as a selected option', async () => {
    const request = deferred(); const { input, list } = setup(() => request.promise);
    expect(list.getAttribute('aria-busy')).toBe('true'); request.resolve(ready([])); await settle();
    expect(list.getAttribute('aria-busy')).toBe('false'); expect(list.textContent).toBe('noNotes');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });
  it.each(['resolve', 'reject'] as const)('ignores an older query that later %ss', async completion => {
    const first = deferred(), second = deferred(); const signals: AbortSignal[] = [];
    const notes = vi.fn((_query: string, signal: AbortSignal) => { signals.push(signal); return signals.length === 1 ? first.promise : second.promise; });
    const { input, list, actions } = setup(notes);
    input.value = 'new'; input.dispatchEvent(new Event('input'));
    expect(signals[0]!.aborted).toBe(true);
    second.resolve(ready([{ path: 'new.md', name: 'New result' }], 'r2')); await settle();
    const resizes = vi.mocked(actions.resize).mock.calls.length;
    if (completion === 'resolve') first.resolve(ready([{ path: 'old.md', name: 'Old result' }], 'r1')); else first.reject(Error('Old failure'));
    await settle(); expect(list.textContent).toBe('New resultnew.md');
    expect(vi.mocked(actions.resize).mock.calls.length).toBe(resizes);
    keyboard(input, 'Enter'); expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith({ resultId: 'r2', path: 'new.md' });
  });
  it.each(['resolve', 'reject'] as const)('does not redraw a cancelled picker after a late %s', async completion => {
    const request = deferred(); const { picker, list, actions } = setup(() => request.promise);
    picker.cancel(); const resizes = vi.mocked(actions.resize).mock.calls.length;
    if (completion === 'resolve') request.resolve(ready([{ path: 'old.md', name: 'Old' }])); else request.reject(Error('Late failure'));
    await settle(); expect(list.textContent).toBe('searching');
    expect(vi.mocked(actions.resize).mock.calls.length).toBe(resizes); expect(actions.selectNote).not.toHaveBeenCalled();
  });
  it('keeps the failed search retryable and replaces the error with new results', async () => {
    const notes = vi.fn().mockRejectedValueOnce(Error('Read failure')).mockResolvedValueOnce(ready([{ path: 'target.md', name: 'Target' }]));
    const { list, actions } = setup(notes); await settle();
    expect(list.getAttribute('aria-busy')).toBe('false'); expect(list.textContent).toBe('metadataErrorretry');
    list.children[0]!.dispatchEvent(new Event('click')); await settle();
    expect(actions.cancelNoteRequests).toHaveBeenCalledTimes(1);
    expect(list.textContent).toBe('Targettarget.md'); expect(notes).toHaveBeenCalledTimes(2);
  });
  it('maps pending, stale and transport errors to their own retryable states', async () => {
    for (const [kind, text] of [['pending', 'metadataPending'], ['stale', 'candidateStale'], ['error', 'metadataError']] as const) {
      const { list } = setup(async () => ({ kind })); await settle();
      expect(list.textContent).toBe(`${text}retry`);
    }
  });
  it('shows result details as option text without a hover label', async () => {
    const { list, input, actions } = setup(async () => ready([
      { path: 'b.md', name: 'B', matchLabel: 'Alias: A' },
      { path: 'bad.md', name: 'Bad', disabledReason: 'tooLong' },
    ]));
    await settle();
    const first = list.children[0]!;
    expect(first.textContent).toBe('Bb.mdAlias: A');
    expect(first.getAttribute('aria-label')).toBeNull();
    first.dispatchEvent(new Event('click'));
    keyboard(input, 'Enter');
    expect(vi.mocked(actions.selectNote).mock.calls).toEqual([
      [{ resultId: 'r1', path: 'b.md' }], [{ resultId: 'r1', path: 'b.md' }],
    ]);
    keyboard(input, 'ArrowDown', false, 'keydown'); keyboard(input, 'Enter');
    expect(actions.explain).toHaveBeenCalledExactlyOnceWith('tooLong');
  });
  it('prefills the initial query before the first search and reports truncation', async () => {
    const notes = vi.fn(async () => ready([{ path: 'a.md', name: 'A' }], 'r1', true));
    const { input, panel } = setup(notes, { initialQuery: 'A' });
    await settle();
    expect(notes).toHaveBeenCalledWith('A', expect.any(AbortSignal));
    expect(input.value).toBe('A');
    expect(panel.textContent).toContain('truncated');
  });
  it('shows an entry notice and clears it on user input', async () => {
    const { panel, input } = setup(undefined, { notice: 'conflict' }); await settle();
    expect(panel.textContent).toContain('conflictNotice');
    input.value = 'x'; input.dispatchEvent(new Event('input')); await settle();
    expect(panel.textContent).not.toContain('conflictNotice');
  });
  it('does not consume composition keys or confirm until the composing Enter has been released', async () => {
    vi.useFakeTimers();
    const { input, actions } = setup(); await settle();
    input.dispatchEvent(new Event('compositionstart'));
    expect(keyboard(input, 'Enter', true).defaultPrevented).toBe(false);
    input.dispatchEvent(new Event('compositionend'));
    vi.runAllTimers();
    keyboard(input, 'Enter');
    expect(actions.selectNote).not.toHaveBeenCalled();
    keyboard(input, 'Enter', false, 'keyup'); keyboard(input, 'Enter');
    expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith({ resultId: 'r1', path: 'target.md' });
  });
  it('lets a new confirmation work after non-keyboard composition completion once the guard tick expires', async () => {
    vi.useFakeTimers();
    const { input, actions } = setup(); await settle();
    input.dispatchEvent(new Event('compositionstart')); input.dispatchEvent(new Event('compositionend'));
    expect(keyboard(input, 'Enter').defaultPrevented).toBe(false);
    expect(actions.selectNote).not.toHaveBeenCalled();
    keyboard(input, 'Enter', false, 'keyup');
    vi.runAllTimers();
    keyboard(input, 'Enter');
    expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith({ resultId: 'r1', path: 'target.md' });
  });
  it('ignores Process keys and clears held Enter state on blur', async () => {
    vi.useFakeTimers();
    const { input, actions } = setup(async () => ready([{ path: 'first.md', name: 'First' }, { path: 'second.md', name: 'Second' }])); await settle();
    expect(keyboard(input, 'Process').defaultPrevented).toBe(false);
    input.dispatchEvent(new Event('compositionstart'));
    keyboard(input, 'Enter', true);
    input.dispatchEvent(new Event('compositionend'));
    vi.runAllTimers();
    input.dispatchEvent(new Event('blur'));
    keyboard(input, 'Enter');
    expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith({ resultId: 'r1', path: 'first.md' });
  });
  it.each(['Enter', 'NumpadEnter'])('waits for physical %s release when the IME reports Process', async code => {
    vi.useFakeTimers();
    const { input, actions } = setup(); await settle();
    input.dispatchEvent(new Event('compositionstart'));
    expect(keyboard(input, 'Process', true, 'keydown', code).defaultPrevented).toBe(false);
    input.dispatchEvent(new Event('compositionend'));
    vi.runAllTimers();
    keyboard(input, 'Enter', false, 'keydown', code, true);
    expect(actions.selectNote).not.toHaveBeenCalled();
    keyboard(input, 'Process', false, 'keyup', code);
    keyboard(input, 'Enter', false, 'keydown', code);
    expect(actions.selectNote).toHaveBeenCalledExactlyOnceWith({ resultId: 'r1', path: 'target.md' });
  });
  it('restores focus to the search input when a focused retry button is replaced, while preserving external focus', async () => {
    const doc = new Doc();
    const panel = new Element('div', doc);
    const notes = vi.fn()
      .mockResolvedValueOnce({ kind: 'pending' } satisfies NoteSearchResult)
      .mockResolvedValueOnce(ready([{ path: 'target.md', name: 'Target' }]));
    const actions: ToolbarActions = {
      notes, format: vi.fn(), explain: vi.fn(), quickLink: vi.fn(), selectNote: vi.fn(), cancelNoteRequests: vi.fn(), close: vi.fn(), resize: vi.fn(),
    };
    const picker = new NotePicker(panel as unknown as HTMLElement, key => key, actions);
    const input = panel.children[0]!;
    const list = panel.children[1]!;
    input.value = 'tar';
    await settle();
    const retry = list.children[0]!;
    retry.focus();
    expect(doc.activeElement).toBe(retry);
    vi.mocked(input.focus).mockClear();
    retry.dispatchEvent(new Event('click'));
    expect(input.focus).toHaveBeenCalledTimes(1);
    expect(doc.activeElement).toBe(input);
    expect(input.value).toBe('tar');
    await settle();
    expect(list.textContent).toBe('Targettarget.md');

    // Automatic refresh while retry is focused also restores focus to input
    const notes2 = vi.fn()
      .mockResolvedValueOnce({ kind: 'pending' } satisfies NoteSearchResult)
      .mockResolvedValueOnce(ready([{ path: 'target.md', name: 'Target' }]));
    const panel2 = new Element('div', doc);
    const picker2 = new NotePicker(panel2 as unknown as HTMLElement, key => key, { ...actions, notes: notes2 });
    const input2 = panel2.children[0]!;
    const list2 = panel2.children[1]!;
    input2.value = 'keep';
    await settle();
    list2.children[0]!.focus();
    vi.mocked(input2.focus).mockClear();
    picker2.refresh();
    expect(input2.focus).toHaveBeenCalledTimes(1);
    expect(doc.activeElement).toBe(input2);
    expect(input2.value).toBe('keep');
    await settle();

    // Focus outside the list (e.g. a sibling control) is not stolen on refresh
    const outside = new Element('button', doc);
    outside.focus();
    vi.mocked(input2.focus).mockClear();
    picker2.refresh();
    expect(input2.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(outside);
    picker.cancel(); picker2.cancel();
  });
  it('explains unavailable targets and leaves native text undo alone', async () => {
    const { input, actions, list } = setup(async () => ready([{ path: 'target.md', name: 'Target', disabledReason: 'tooLong' }])); await settle();
    expect(list.children[0]!.getAttribute('aria-disabled')).toBe('true');
    keyboard(input, 'Enter'); expect(actions.explain).toHaveBeenCalledExactlyOnceWith('tooLong'); expect(actions.selectNote).not.toHaveBeenCalled();
    expect(keyboard(input, 'z').defaultPrevented).toBe(false);
  });
});
