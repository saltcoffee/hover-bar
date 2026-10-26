/** Keep the editor selection while activating buttons in both WebKit and Chromium. */
export function enableTouchActions(root: HTMLElement): void {
  let tap: { target: HTMLElement; id: number; x: number; y: number; moved: boolean } | null = null;
  root.addEventListener('touchstart', event => {
    tap = null;
    const point = event.touches[0];
    if (!point || event.touches.length !== 1) return;
    const target = event.composedPath().find(node =>
      (node as Element).tagName === 'BUTTON' || (node as Element).getAttribute?.('role') === 'option') as HTMLElement | undefined;
    if (target) tap = { target, id: point.identifier, x: point.clientX, y: point.clientY, moved: false };
  }, { passive: true });
  root.addEventListener('touchmove', event => {
    if (!tap) return;
    const point = [...event.touches].find(point => point.identifier === tap!.id);
    if (!point || Math.hypot(point.clientX - tap.x, point.clientY - tap.y) > 10) tap.moved = true;
  }, { passive: true });
  root.addEventListener('touchcancel', () => { tap = null; }, { passive: true });
  root.addEventListener('touchend', event => {
    const completed = tap; tap = null;
    if (!completed || completed.moved || event.touches.length || !completed.target.isConnected) return;
    const point = [...event.changedTouches].find(point => point.identifier === completed.id);
    if (!point || Math.hypot(point.clientX - completed.x, point.clientY - completed.y) > 10) return;
    // WebKit suppresses click after a cancelled pointerdown. Activate explicitly and
    // cancel the compatibility click so Chromium does not apply a toggle twice.
    event.preventDefault(); completed.target.click();
  }, { passive: false });
}
