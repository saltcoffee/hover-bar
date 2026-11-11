import { describe, expect, it } from 'vitest';
import { toolbarModel } from '../src/editor/toolbar-model';
import { DEFAULTS } from '../src/settings/model';
import { setActionState } from '../src/ui/controls';
import { selectionFixture } from './support/selection';

async function model(text: string) {
  const fixture = await selectionFixture(text);
  const result = fixture.capture();
  if (result.kind !== 'ready') throw Error('No snapshot');
  return toolbarModel(result.snapshot, DEFAULTS, key => key);
}

describe('multi-line toolbar state', () => {
  it('shows all, none, and mixed states for basic formats', async () => {
    expect((await model('甲\n乙')).controls.bold).toMatchObject({ enabled: true, pressed: false });
    expect((await model('**甲**\n**乙**')).controls.bold).toMatchObject({ enabled: true, pressed: true });
    expect((await model('**甲**\n乙')).controls.bold).toMatchObject({ enabled: true, pressed: false, mixed: true });
  });
  it('disables colors, inline code, links, and note picking for multi-line selections', async () => {
    const view = await model('甲\n乙');
    expect(view.controls.foreground).toMatchObject({ enabled: false, reason: 'multiLineDisabled' });
    expect(view.controls.background).toMatchObject({ enabled: false, reason: 'multiLineDisabled' });
    expect(view.controls.clearColors).toMatchObject({ enabled: false, reason: 'multiLineDisabled' });
    expect(view.controls.code).toMatchObject({ enabled: false, reason: 'multiLineDisabled' });
    expect(view.controls.link).toMatchObject({ enabled: false, reason: 'multiLineDisabled' });
    expect(view.controls.chooseNote).toMatchObject({ enabled: false, reason: 'multiLineDisabled' });
  });
  it('degrades a single line to the existing behavior', async () => {
    const view = await model('word');
    expect(view.controls.bold).toMatchObject({ enabled: true, pressed: false });
    expect(view.controls.foreground).toMatchObject({ enabled: true });
  });
  it('maps a mixed action to aria-pressed="mixed"', () => {
    const attributes = new Map<string, string>();
    const button = { setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) } as unknown as HTMLButtonElement;
    setActionState(button, { enabled: true, pressed: false, mixed: true }, 'Bold');
    expect(attributes.get('aria-pressed')).toBe('mixed');
  });
});
