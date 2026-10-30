import { describe, expect, it, vi } from 'vitest';
import { ToolbarPanels } from '../src/ui/toolbar-panels';
import { TestDocument } from './support/dom';

vi.mock('obsidian', () => ({ setIcon: vi.fn() }));

function setup(columns: number) {
  const document = new TestDocument();
  const back = document.createElement('button'), body = document.createElement('div'), reset = document.createElement('button');
  const swatches = new Map(Array.from({ length: 8 }, (_value, index) => [String(index), document.createElement('button')]));
  for (const [id, button] of swatches) { button.dataset.swatch = id; button.tabIndex = id === '0' ? 0 : -1; body.append(button); }
  body.append(reset); document.body.append(back, body);
  const panels = Object.create(ToolbarPanels.prototype) as ToolbarPanels;
  Object.assign(panels, { document, body, back, reset, swatches, columns, state: { kind: 'palette', palette: 'foreground' } });
  const key = (value: string, shiftKey = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: value, shiftKey });
    panels.onKey(event as unknown as KeyboardEvent); return event;
  };
  return { document, back, reset, swatches: [...swatches.values()], key };
}

describe('palette keyboard navigation', () => {
  it.each([1, 2, 3, 4])('uses the applied %s-column grid and exposes Back and reset', columns => {
    const { document, swatches, back, reset, key } = setup(columns);
    swatches[0]!.focus(); key('ArrowDown'); expect(document.activeElement).toBe(swatches[columns]);
    key('Home'); key('ArrowUp'); expect(document.activeElement).toBe(back);
    key('ArrowDown'); expect(document.activeElement).toBe(swatches[0]);
    key('End'); key('ArrowDown'); expect(document.activeElement).toBe(reset);
    key('ArrowUp'); expect(document.activeElement).toBe(swatches[7]);
  });
  it('explicitly hands Tab focus between Back, the roving color and reset without trapping exit', () => {
    const { document, swatches, back, reset, key } = setup(1);
    back.focus(); expect(key('Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(swatches[0]);
    key('End'); expect(swatches[7]!.tabIndex).toBe(0); expect(swatches[0]!.tabIndex).toBe(-1);
    key('Tab'); expect(document.activeElement).toBe(reset);
    key('Tab', true); expect(document.activeElement).toBe(swatches[7]);
    key('Tab', true); expect(document.activeElement).toBe(back);
    expect(key('Tab', true).defaultPrevented).toBe(false);
    reset.focus(); expect(key('Tab').defaultPrevented).toBe(false);
  });
  it('keeps navigation inside a partial last row and does not consume typing keys', () => {
    const { document, swatches, key } = setup(3);
    swatches[5]!.focus(); key('ArrowDown'); expect(document.activeElement).toBe(swatches[7]);
    expect(key('a').defaultPrevented).toBe(false);
  });
});
