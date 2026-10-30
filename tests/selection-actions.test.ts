import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { applyEdit } from '../src/editor/apply-edit';
import { formatSelection, linkSelection } from '../src/editor/selection-actions';
import { DEFAULTS } from '../src/settings/model';
import { toolbarModel } from '../src/editor/toolbar-model';
import { linkPlan } from '../src/links/wikilink';
import { locateFragment } from '../src/formatting/fragment';
import { formatFragment } from '../src/formatting/markdown';
import { selectionFixture } from './support/selection';

describe('whole-line budget shared by display and commit', () => {
  it.each([9997, 9999])('rejects an over-budget result before writing from a %s-unit line', async length => {
    const fixture = await selectionFixture('a'.repeat(length), { from: 1, to: 2 });
    const captured = fixture.capture(); if (captured.kind !== 'ready') throw Error('No snapshot');
    const snapshot = captured.snapshot;
    expect(formatSelection(snapshot, 'bold')).toEqual({ kind: 'unavailable', reason: 'tooLong' });
    expect(toolbarModel(snapshot, DEFAULTS, key => key).controls.bold).toMatchObject({ enabled: false, reason: 'tooLong' });
    const unguarded = formatFragment(snapshot.located, snapshot.source, 'bold');
    if (unguarded.kind !== 'edit') throw Error('Expected a fragment plan');
    expect(applyEdit(fixture.view, snapshot, unguarded.plan)).toBe(false);
    expect(fixture.dispatches).toBe(0); expect(undo(fixture.view)).toBe(false);
  });
  it('allows exactly 10,000 units, recaptures and can shorten the formatted line', async () => {
    const fixture = await selectionFixture('a'.repeat(9996), { from: 1, to: 2, reverse: true });
    const before = fixture.capture(); if (before.kind !== 'ready') throw Error('No snapshot');
    const add = formatSelection(before.snapshot, 'bold'); if (add.kind !== 'edit') throw Error('No plan');
    expect(applyEdit(fixture.view, before.snapshot, add.plan)).toBe(true); expect(fixture.view.state.doc.length).toBe(10_000);
    const after = fixture.capture(); if (after.kind !== 'ready') throw Error('Cannot continue');
    expect(after.snapshot.anchor).toBeGreaterThan(after.snapshot.head);
    const remove = formatSelection(after.snapshot, 'bold'); if (remove.kind !== 'edit') throw Error('No inverse');
    expect(applyEdit(fixture.view, after.snapshot, remove.plan)).toBe(true); expect(fixture.view.state.doc.length).toBe(9996);
    undo(fixture.view); expect(fixture.view.state.doc.length).toBe(10_000);
  });
  it('counts structural prefixes in the budget and refuses malformed cross-line plans', async () => {
    const fixture = await selectionFixture('# ' + 'a'.repeat(9994), { from: 3, to: 4 });
    const captured = fixture.capture(); if (captured.kind !== 'ready') throw Error('No snapshot');
    const result = formatSelection(captured.snapshot, 'bold'); if (result.kind !== 'edit') throw Error('No plan');
    expect(applyEdit(fixture.view, captured.snapshot, { ...result.plan, insert: 'a\nb' })).toBe(false);
    expect(applyEdit(fixture.view, captured.snapshot, result.plan)).toBe(true); expect(fixture.view.state.doc.length).toBe(10_000);
  });
  it('protects the final transaction from composition or a changed selection count', async () => {
    const fixture = await selectionFixture(); const captured = fixture.capture(); if (captured.kind !== 'ready') throw Error('No snapshot');
    const result = formatSelection(captured.snapshot, 'bold'); if (result.kind !== 'edit') throw Error('No plan');
    Object.defineProperty(fixture.view, 'composing', { value: true });
    expect(applyEdit(fixture.view, captured.snapshot, result.plan)).toBe(false); expect(fixture.dispatches).toBe(0);
  });
  it.each([
    { name: 'resulting line', source: 'a'.repeat(9999), from: 1, to: 2 },
    { name: 'fragment output', source: 'a'.repeat(9997), from: 0, to: 9997 },
    { name: 'structural prefix', source: '# ' + 'a'.repeat(9995), from: 2, to: 3 },
  ])('disables an over-budget quick link before activation: $name', async ({ source, from, to }) => {
    const fixture = await selectionFixture(source, { from, to });
    const captured = fixture.capture(); if (captured.kind !== 'ready') throw Error('No snapshot');
    const snapshot = captured.snapshot, model = toolbarModel(snapshot, DEFAULTS, key => key);
    expect(model.controls.link).toEqual({ enabled: false, reason: 'tooLong' });
    expect(linkSelection(snapshot, snapshot.located.fragment.text)).toEqual({ kind: 'unavailable', reason: 'tooLong' });
    // A note-picker target is still unknown; each actual candidate is checked separately.
    expect(model.controls.chooseNote).toEqual({ enabled: true });
    expect(fixture.dispatches).toBe(0); expect(undo(fixture.view)).toBe(false);
  });
  it.each([false, true])('allows a quick link at exactly 10,000 units (wholeSelection=%s)', async wholeSelection => {
    const source = 'a'.repeat(9996);
    const fixture = await selectionFixture(source, { from: wholeSelection ? 0 : 1, to: wholeSelection ? source.length : 2 });
    const captured = fixture.capture(); if (captured.kind !== 'ready') throw Error('No snapshot');
    const snapshot = captured.snapshot;
    expect(toolbarModel(snapshot, DEFAULTS, key => key).controls.link).toEqual({ enabled: true });
    const result = linkSelection(snapshot, snapshot.located.fragment.text); if (result.kind !== 'edit') throw Error('No link plan');
    expect(applyEdit(fixture.view, snapshot, result.plan)).toBe(true); expect(fixture.view.state.doc.length).toBe(10_000);
    expect(undo(fixture.view)).toBe(true); expect(fixture.view.state.doc.toString()).toBe(source);
  });
});

describe('link and action rejection reasons', () => {
  it.each([['`word`', 'codeOnly'], ['**word**', 'plainOnly'], ['bad|name', 'invalidText']] as const)('reports the actual source restriction: %s', (source, reason) => {
      const located = locateFragment(source, 0, source.length)!;
      expect(linkPlan(located, source, 'target')).toEqual({ kind: 'unavailable', reason });
    });
  it('distinguishes invalid targets, fragment output and resulting-line limits', async () => {
    const fixture = await selectionFixture('a'.repeat(9997)); const result = fixture.capture(); if (result.kind !== 'ready') throw Error('No snapshot');
    expect(linkSelection(result.snapshot, 'bad#target')).toEqual({ kind: 'unavailable', reason: 'invalidTarget' });
    expect(linkSelection(result.snapshot, result.snapshot.located.fragment.text)).toEqual({ kind: 'unavailable', reason: 'tooLong' });
    const short = await selectionFixture('a'.repeat(9999), { from: 1, to: 2 }); const selected = short.capture(); if (selected.kind !== 'ready') throw Error('No snapshot');
    expect(linkSelection(selected.snapshot, 'note')).toEqual({ kind: 'unavailable', reason: 'tooLong' });
  });
  it('does not label code conflicts as length failures or invalid links', async () => {
    const fixture = await selectionFixture('`word`'); const result = fixture.capture(); if (result.kind !== 'ready') throw Error('No snapshot');
    const model = toolbarModel(result.snapshot, DEFAULTS, key => key);
    expect(model.controls.bold).toMatchObject({ enabled: false, reason: 'codeOnly' });
    expect(model.controls.link).toMatchObject({ enabled: false, reason: 'codeOnly' });
    expect(model.controls.code).toMatchObject({ enabled: true, pressed: true });
    expect(model.resets.foreground).toMatchObject({ enabled: false, reason: 'codeOnly' });
  });
});
