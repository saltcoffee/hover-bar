import { describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../src/ui/toolbar';

vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<typeof import('obsidian')>(), setIcon: vi.fn(),
}));

function panelSession(focused: boolean) {
  const input = {};
  const editor = {};
  const body = {};
  const document = { activeElement: focused ? input : editor };
  const button = { focus: vi.fn(() => { document.activeElement = button; }) };
  let attached = true;
  // Model the browser boundary: removing a focused input moves focus to the body.
  const panel = {
    hidden: false, setAttribute: vi.fn(),
    replaceChildren: () => { if (document.activeElement === input) document.activeElement = body; attached = false; },
  };
  const toolbar = Object.create(Toolbar.prototype) as Toolbar;
  Object.assign(toolbar, {
    document, root: { hidden: false, contains: (node: unknown) => node === button || (attached && node === input) },
    panel, openPanel: 'chooseNote', returnTo: null, touch: true, fragment: null,
    queryAbort: null, queryId: 0, controls: new Map(), t: (key: string) => key, actions: { resize: vi.fn() },
  });
  return { toolbar, document, button, editor };
}

describe('toolbar panel focus handoff', () => {
  it.each(['foreground', 'background', 'more'] as const)('retains ownership when switching a focused search to %s', key => {
    const { toolbar, document, button } = panelSession(true);
    expect(toolbar['startPanel'](key, button as unknown as HTMLButtonElement)).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(toolbar.ownsFocus()).toBe(true);
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
  it('does not steal editor focus when opening a touch panel without a focused search', () => {
    const { toolbar, document, button, editor } = panelSession(false);
    toolbar['startPanel']('foreground', button as unknown as HTMLButtonElement);
    expect(document.activeElement).toBe(editor); expect(button.focus).not.toHaveBeenCalled();
  });
});
