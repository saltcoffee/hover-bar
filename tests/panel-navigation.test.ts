import { describe, expect, it } from 'vitest';
import { backState, expandedPanel, type PanelState } from '../src/ui/panel-navigation';

describe('bounded panel navigation', () => {
  it.each(['foreground', 'background'] as const)('returns from a direct %s palette to the bar', palette => {
    const state: PanelState = { kind: 'palette', palette, origin: { kind: 'bar', actionId: palette } };
    expect(expandedPanel(state, palette)).toBe(true); expect(expandedPanel(state, 'more')).toBe(false);
    expect(backState(state)).toEqual({ kind: 'none' });
  });
  it.each(['foreground', 'background', 'chooseNote'] as const)('preserves the More origin, row and scroll when returning from %s', id => {
    const origin = { kind: 'more', actionId: id, scrollTop: 127 } as const;
    const state: PanelState = id === 'chooseNote' ? { kind: 'notes', origin } : { kind: 'palette', palette: id, origin };
    expect(expandedPanel(state, 'more')).toBe(true);
    const parent = backState(state);
    expect(parent).toEqual({ kind: 'more', scrollTop: 127, focusId: id });
    expect(backState(parent)).toEqual({ kind: 'none' });
  });
  it('returns from direct notes without retaining an old More parent', () => {
    const state: PanelState = { kind: 'notes', origin: { kind: 'bar', actionId: 'chooseNote' } };
    expect(backState(state)).toEqual({ kind: 'none' }); expect(expandedPanel(state, 'more')).toBe(false);
  });
});

