import { describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { capture, inspectSyntax } from '../src/editor/context';
import { selectionFixture } from './support/selection';

describe('selection diagnosis and precedence', () => {
  it.each(['loadError', 'schemaError', 'conflict'] as const)('reports unavailable preferences: %s', async status => {
    const fixture = await selectionFixture(); fixture.store.status = status;
    expect(fixture.capture()).toEqual({ kind: 'blocked', reason: { kind: 'preferences', status } });
    expect(fixture.dispatches).toBe(0);
  });
  it('continues with active in-memory preferences after a failed save', async () => {
    const fixture = await selectionFixture(); fixture.store.status = 'saveError';
    expect(fixture.capture().kind).toBe('ready');
  });
  it('distinguishes a missing editor, reading view and a disabled editing mode', async () => {
    const fixture = await selectionFixture();
    expect(capture(fixture.view, { workspace: { getLeavesOfType: () => [] } } as unknown as typeof fixture.app, fixture.store))
      .toMatchObject({ kind: 'blocked', reason: { kind: 'noEditor' } });
    expect((await selectionFixture('word', { mode: 'preview' })).capture()).toMatchObject({ reason: { kind: 'noEditor' } });
    await fixture.store.set('livePreview', false);
    expect(fixture.capture()).toMatchObject({ reason: { kind: 'modeDisabled', mode: 'livePreview' } });
    const source = await selectionFixture('word', { live: false }); await source.store.set('sourceMode', false);
    expect(source.capture()).toMatchObject({ reason: { kind: 'modeDisabled', mode: 'source' } });
  });
  it('prioritizes read-only state over composition and cross-line content', async () => {
    const fixture = await selectionFixture('one\ntwo', { readOnly: true, composing: true });
    expect(fixture.capture()).toMatchObject({ reason: { kind: 'readOnly' } });
    expect((await selectionFixture('word', { editable: EditorView.editable.of(false) })).capture()).toMatchObject({ reason: { kind: 'readOnly' } });
  });
  it('rejects composition and multiple selections before an empty main selection', async () => {
    expect((await selectionFixture('word', { composing: true })).capture()).toMatchObject({ reason: { kind: 'composing' } });
    expect((await selectionFixture('word', { multiple: true })).capture()).toMatchObject({ reason: { kind: 'multipleSelections' } });
  });
  it.each([{ text: 'word', from: 1, to: 1 }, { text: ' \t ', from: 0, to: 3 }])('rejects empty or whitespace selections: $text', async ({ text, from, to }) => {
    expect((await selectionFixture(text, { from, to })).capture()).toMatchObject({ reason: { kind: 'emptySelection' } });
  });
  it('prioritizes selection length over real newlines and checks the entire input line', async () => {
    expect((await selectionFixture('a'.repeat(10_000) + '\nb')).capture()).toMatchObject({ reason: { kind: 'tooLong', stage: 'selection' } });
    expect((await selectionFixture('a'.repeat(10_001), { from: 2, to: 3 })).capture()).toMatchObject({ reason: { kind: 'tooLong', stage: 'line' } });
    expect((await selectionFixture('one\ntwo')).capture()).toMatchObject({ reason: { kind: 'multipleLines' } });
  });
  it('separates pending parsing, known protected syntax, structural prefixes and unsupported fragments', async () => {
    const pending = await selectionFixture('word', { pending: true });
    expect(inspectSyntax(pending.view.state, 0, 4)).toBe('pending');
    expect(pending.capture()).toMatchObject({ reason: { kind: 'syntaxPending' } });
    for (const [text, from, to] of [['```\nword\n```', 4, 8], ['# title', 0, 7], ['- item', 0, 6]] as const) {
      expect((await selectionFixture(text, { from, to })).capture()).toMatchObject({ reason: { kind: 'protectedSyntax' } });
    }
    for (const [text, from, to] of [['**word**', 2, 4], ['a **word**', 0, 10], ['😀', 0, 1]] as const) {
      expect((await selectionFixture(text, { from, to })).capture()).toMatchObject({ reason: { kind: 'unsupportedFragment' } });
    }
  });
  it.each([['# title', 2, 7], ['- [ ] item', 6, 10], ['> quote', 2, 7], ['中文 😀', 0, 5]] as const)('captures valid text including full input-line length: %s', async (text, from, to) => {
      const fixture = await selectionFixture(text, { from, to, reverse: true });
      const result = fixture.capture(); expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') throw Error('No snapshot');
      expect(result.snapshot.lineLength).toBe(text.length); expect(result.snapshot.anchor).toBe(to);
      expect(result.snapshot.head).toBe(from); expect(fixture.dispatches).toBe(0);
    });
});
