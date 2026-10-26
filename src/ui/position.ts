export interface Box { left: number; right: number; top: number; bottom: number }
export interface Position { left: number; top: number }

export function viewportBounds(width: number, height: number, viewport?: Pick<VisualViewport, 'offsetLeft' | 'offsetTop' | 'width' | 'height'> | null): Box {
  return viewport
    ? { left: viewport.offsetLeft, top: viewport.offsetTop, right: viewport.offsetLeft + viewport.width, bottom: viewport.offsetTop + viewport.height }
    : { left: 0, top: 0, right: width, bottom: height };
}

// Touch selection handles and the native edit menu stay near the text; dock away from them.
export function placeTouch(anchor: Box | null, bounds: Box, width: number, height: number, gap = 8): Position | null {
  if (width > bounds.right - bounds.left - gap * 2 || height > bounds.bottom - bounds.top - gap * 2) return null;
  let top = bounds.bottom - height - gap;
  if (anchor && top < anchor.bottom + 24) {
    top = bounds.top + gap;
    if (top + height > anchor.top - 24) return null;
  }
  return { left: bounds.left + (bounds.right - bounds.left - width) / 2, top };
}

export function place(anchor: Box, bounds: Box, width: number, height: number, gap = 8): Position | null {
  const leftEdge = bounds.left + gap;
  const rightEdge = bounds.right - gap;
  if (width > rightEdge - leftEdge || anchor.top < bounds.top || anchor.bottom > bounds.bottom) return null;
  let top = anchor.top - height - gap;
  if (top < bounds.top + gap) top = anchor.bottom + gap;
  if (top + height > bounds.bottom - gap) return null;
  const center = (anchor.left + anchor.right) / 2;
  return { left: Math.max(leftEdge, Math.min(rightEdge - width, center - width / 2)), top };
}
