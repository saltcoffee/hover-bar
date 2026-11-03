import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateEffect } from '@codemirror/state';
import { ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { colorPreview } from '../src/editor/color-preview';
import type { Host } from '../src/editor/controller';
import { PALETTE } from '../src/formatting/colors';
import { MAX_SOURCE } from '../src/formatting/types';
import { selectionFixture } from './support/selection';

interface Preview { decorations: DecorationSet; update(update: ViewUpdate): void }
const span = '<span style="color:#123456">text</span>';
afterEach(() => { vi.restoreAllMocks(); });

async function setup(source = span, options: Parameters<typeof selectionFixture>[1] = {}) {
  const fixture = await selectionFixture(source, options);
  let ranges = [{ from: 0, to: source.length }];
  Object.defineProperty(fixture.view, 'visibleRanges', { get: () => ranges });
  const host: Host = { app: fixture.app, store: fixture.store, t: key => key, controllers: new Set(), notify: vi.fn() };
  // Capture the registered class without creating a DOM view. Decorations and syntax are real.
  const register = vi.spyOn(ViewPlugin, 'fromClass'); colorPreview(host);
  const Constructor = register.mock.lastCall![0] as new (view: EditorView) => Preview; register.mockRestore();
  const preview = new Constructor(fixture.view);
  const update = (flags: Partial<ViewUpdate> = {}) => preview.update({ view: fixture.view, state: fixture.view.state,
    docChanged: false, viewportChanged: false, ...flags } as ViewUpdate);
  const visible = (next: typeof ranges) => { ranges = next; update({ viewportChanged: true }); };
  const marks = () => {
    const result = [];
    for (const cursor = preview.decorations.iter(); cursor.value; cursor.next()) result.push({ from: cursor.from, to: cursor.to,
      class: cursor.value.spec.class as string, style: cursor.value.spec.attributes.style as string });
    return result;
  };
  return { ...fixture, preview, update, visible, marks };
}

describe('custom color preview decorations', () => {
  it.each([
    ['color:#123456', 'hover-bar-color-foreground', '--hover-bar-foreground:#123456'],
    ['background-color:#fedcba', 'hover-bar-color-background', '--hover-bar-background:#fedcba'],
    ['color:#123456;background-color:#fedcba', 'hover-bar-color-foreground hover-bar-color-background', '--hover-bar-foreground:#123456;--hover-bar-background:#fedcba'],
  ])('decorates only the content for %s without requiring a preset', async (style, classes, variables) => {
    expect(PALETTE.map(color => color.foreground)).not.toContain('#123456');
    expect(PALETTE.map(color => color.background)).not.toContain('#fedcba');
    const source = `before <span style="${style}">x &amp; y</span> after`, from = source.indexOf('x &amp; y');
    const fixture = await setup(source);
    expect(fixture.marks()).toEqual([{ from, to: from + 'x &amp; y'.length, class: classes, style: variables }]);
  });
  it.each(['color:#ABC', 'color:#123', 'color:red', 'color:#123456;position:fixed', 'background-color:url(x)', 'color:#123456;'])('rejects unsupported style %s', async style => {
    expect((await setup(`<span style="${style}">text</span>`)).marks()).toEqual([]);
  });
  it('scans visible logical lines once and replaces decorations when the viewport moves', async () => {
    const source = [span, span, span].join('\n'), fixture = await setup(source);
    const line = fixture.view.state.doc.line(2);
    fixture.visible([{ from: line.from + 1, to: line.to - 1 }, { from: line.from + 2, to: line.to }]);
    expect(fixture.marks()).toEqual([{ from: line.from + span.indexOf('text'), to: line.from + span.indexOf('text') + 4,
      class: 'hover-bar-color-foreground', style: '--hover-bar-foreground:#123456' }]);
    fixture.visible([{ from: 0, to: span.length }]);
    expect(fixture.marks().map(mark => mark.from)).toEqual([span.indexOf('text')]);
  });
  it.each([`\`\`\`html\n${span}\n\`\`\``, `    ${span}`, `| color |\n| --- |\n| ${span} |`])('does not decorate protected syntax: %s', async source => {
    expect((await setup(source)).marks()).toEqual([]);
  });
  it('does not decorate while syntax is pending', async () => {
    expect((await setup(span, { pending: true })).marks()).toEqual([]);
  });
  it('accepts the line length limit and skips longer lines', async () => {
    const prefix = 'x'.repeat(MAX_SOURCE - span.length);
    expect((await setup(prefix + span)).marks()).toHaveLength(1);
    expect((await setup(prefix + 'x' + span)).marks()).toEqual([]);
  });
  it('requires Live Preview, enabled preferences and the matching Obsidian editor', async () => {
    expect((await setup(span, { live: false })).marks()).toEqual([]);
    const fixture = await setup();
    await fixture.store.set('livePreview', false); fixture.update(); expect(fixture.marks()).toEqual([]);
    await fixture.store.set('livePreview', true); fixture.update(); expect(fixture.marks()).toHaveLength(1);
    fixture.hostView.editor = {} as typeof fixture.hostView.editor;
    fixture.update({ viewportChanged: true }); expect(fixture.marks()).toEqual([]);
    const blocked = await setup(); blocked.store.status = 'loadError'; blocked.update({ viewportChanged: true });
    expect(blocked.marks()).toEqual([]);
  });
  it('rebuilds after document changes, not after history, save or conflict notifications', async () => {
    const fixture = await setup(), decorations = fixture.preview.decorations, state = fixture.view.state;
    fixture.store.recordColorUse('background', '#aabbcc'); fixture.update();
    fixture.store.historyStatus = 'saveError'; fixture.update();
    fixture.store.historyStatus = 'conflict'; fixture.update();
    expect(fixture.preview.decorations).toBe(decorations); expect(fixture.view.state).toBe(state);
    fixture.view.dispatch({ changes: { from: 0, to: state.doc.length, insert: 'plain' } });
    fixture.update({ docChanged: true }); expect(fixture.marks()).toEqual([]);
  });
  it('clears decorations when the live mode field is removed', async () => {
    const fixture = await setup();
    fixture.view.dispatch({ effects: StateEffect.reconfigure.of([]) }); fixture.update();
    expect(fixture.marks()).toEqual([]);
  });
});
