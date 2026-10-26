import { describe, expect, it } from 'vitest';
import { placeTouch, viewportBounds } from '../src/ui/position';

describe('mobile viewport placement', () => {
  const bounds = { left: 0, right: 390, top: 0, bottom: 420 };
  it('uses the keyboard-reduced and panned visual viewport, with a layout fallback', () => {
    expect(viewportBounds(390, 844, { offsetLeft: 12, offsetTop: 40, width: 360, height: 380 }))
      .toEqual({ left: 12, right: 372, top: 40, bottom: 420 });
    expect(viewportBounds(390, 844, null)).toEqual({ left: 0, right: 390, top: 0, bottom: 844 });
  });
  it('docks near the bottom away from text selection handles', () => {
    expect(placeTouch({ left: 0, right: 100, top: 100, bottom: 120 }, bounds, 374, 54)).toEqual({ left: 8, top: 358 });
  });
  it('uses space above a low selection and hides when neither side fits', () => {
    expect(placeTouch({ left: 0, right: 100, top: 350, bottom: 370 }, bounds, 374, 200)).toEqual({ left: 8, top: 8 });
    expect(placeTouch({ left: 0, right: 100, top: 150, bottom: 300 }, bounds, 374, 200)).toBeNull();
  });
  it('retains focused search at the bottom even when its original selection is outside the viewport', () => {
    expect(placeTouch(null, bounds, 374, 300)).toEqual({ left: 8, top: 112 });
  });
  it('rejects overflowing panels in narrow or short viewports', () => {
    expect(placeTouch(null, bounds, 380, 54)).toBeNull();
    expect(placeTouch(null, bounds, 374, 410)).toBeNull();
  });
});
