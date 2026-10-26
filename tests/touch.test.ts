import { describe, expect, it, vi } from 'vitest';
import { enableTouchActions } from '../src/ui/touch';

function setup(role = 'BUTTON') {
  const root = new EventTarget();
  const target = { tagName: role === 'option' ? 'DIV' : role, getAttribute: () => role === 'option' ? 'option' : null, isConnected: true, click: vi.fn() };
  enableTouchActions(root as HTMLElement);
  const point = (x: number, y = 0, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  const send = (type: string, touches = [point(0)], changedTouches = [point(0)]) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { touches, changedTouches });
    event.composedPath = () => [target as unknown as HTMLElement, root]; root.dispatchEvent(event); return event;
  };
  return { target, point, send };
}

describe('touch activation without changing the editor selection', () => {
  it.each(['BUTTON', 'option'])('activates a %s once and cancels the native compatibility click', role => {
    const { target, send } = setup(role);
    expect(send('touchstart').defaultPrevented).toBe(false);
    expect(send('touchend', []).defaultPrevented).toBe(true);
    send('touchend', []); expect(target.click).toHaveBeenCalledTimes(1);
  });
  it('allows horizontal and vertical scrolling without activating the touched action', () => {
    for (const direction of ['horizontal', 'vertical']) {
      const { target, point, send } = setup();
      send('touchstart'); const to = direction === 'horizontal' ? point(40) : point(0, 40);
      expect(send('touchmove', [to]).defaultPrevented).toBe(false);
      expect(send('touchend', [], [to]).defaultPrevented).toBe(false);
      expect(target.click).not.toHaveBeenCalled();
    }
  });
  it('ignores cancellation, multiple fingers, disconnected actions, and input fields', () => {
    for (const reason of ['cancel', 'multi', 'removed', 'input']) {
      const { target, point, send } = setup(reason === 'input' ? 'INPUT' : 'BUTTON');
      send('touchstart');
      if (reason === 'cancel') send('touchcancel', []);
      if (reason === 'multi') send('touchstart', [point(0), point(10, 10, 2)]);
      if (reason === 'removed') target.isConnected = false;
      send('touchend', []); expect(target.click).not.toHaveBeenCalled();
    }
  });
  it('checks the release position even when no touchmove event was delivered', () => {
    const { target, point, send } = setup();
    send('touchstart'); send('touchend', [], [point(30)]); expect(target.click).not.toHaveBeenCalled();
  });
});
