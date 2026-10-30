import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { Language, defineLanguageFacet, ensureSyntaxTree, languageDataProp } from '@codemirror/language';
import { parser } from '@lezer/markdown';
import type { App, TFile } from 'obsidian';
import { EditorController } from '../../src/editor/controller';
import { revisionField } from '../../src/editor/context';
import { PALETTE } from '../../src/formatting/colors';
import { translator } from '../../src/i18n';
import { PreferencesStore } from '../../src/settings/store';
import { ACTION_IDS, resolveLayout, type ActionId } from '../../src/toolbar/layout';
import { Toolbar, type ToolbarMeasurement } from '../../src/ui/toolbar';
import type { ActionOutcome, ToolbarId, ToolbarViewModel } from '../../src/ui/toolbar-types';
import { editorInfoField, editorLivePreviewField, MarkdownView } from './obsidian';

export interface FixtureOptions {
  pinned?: ActionId[];
  width?: number;
  outcome?: ActionOutcome['kind'];
  disabled?: ToolbarId[];
  controller?: boolean;
}
export interface FixtureEvent { type: string; action?: string; color?: string }
export interface ToolbarFixture {
  mount(options?: FixtureOptions): Promise<void>;
  layout(width: number, pinned?: ActionId[]): ToolbarMeasurement;
  resizeEditor(width: number): void;
  inspect(): { events: FixtureEvent[]; scope: { pushes: number; pops: number }; text: string; selection: number[] };
}
declare global { interface Window { toolbarTest: ToolbarFixture } }

const t = translator(() => 'en');
let toolbar: Toolbar | null = null;
let view: EditorView | null = null;
let controller: EditorController | undefined;
let store: PreferencesStore | null = null;
let model: ToolbarViewModel;
let width = 640;
let events: FixtureEvent[] = [];
let scope = { pushes: 0, pops: 0 };

function layout(nextWidth: number, pinned?: ActionId[]): ToolbarMeasurement {
  if (!toolbar) throw Error('Direct Toolbar fixture is not mounted');
  width = nextWidth;
  if (pinned) {
    model = { ...model, layout: resolveLayout({ kind: 'custom', pinned }) };
    toolbar.update(model);
  }
  const measurement = toolbar.readLayout({ left: 0, right: width, top: 0, bottom: 600 }, 280);
  toolbar.applyLayout(measurement); toolbar.positioned(40, 40);
  return measurement;
}

async function mount(options: FixtureOptions = {}): Promise<void> {
  toolbar?.destroy(); toolbar = null;
  view?.destroy(); view = null; controller = undefined; store?.destroy(); store = null;
  document.querySelector('#outside')?.remove();
  events = []; scope = { pushes: 0, pops: 0 }; width = options.width ?? 640;
  if (options.controller) await mountController(options);
  else {
    const state = (id: ToolbarId) => ({ enabled: !options.disabled?.includes(id), reason: 'Unavailable here' });
    model = {
      layout: resolveLayout(options.pinned ? { kind: 'custom', pinned: options.pinned } : { kind: 'default' }),
      controls: Object.fromEntries([...ACTION_IDS, 'more' as const].map(id => [id, state(id)])) as ToolbarViewModel['controls'],
      palettes: Object.fromEntries((['foreground', 'background'] as const).map(kind => [kind,
        PALETTE.map(color => ({ id: color.id, color: color[kind], label: color.id, enabled: true })),
      ])) as unknown as ToolbarViewModel['palettes'],
      resets: { foreground: { enabled: true }, background: { enabled: true } },
    };
    toolbar = new Toolbar(document, t, {
      format: (action, color) => {
        events.push({ type: 'format', action, color });
        const kind = options.outcome ?? 'applied';
        if (kind === 'closed') toolbar!.hide();
        return { kind };
      },
      explain: reason => events.push({ type: 'explain', action: reason }),
      quickLink: () => { events.push({ type: 'quickLink' }); toolbar!.notePicker(); },
      notes: async () => [{ name: 'Concept', path: 'Concept.md' }],
      selectNote: path => { events.push({ type: 'selectNote', action: path }); toolbar!.hide(); },
      close: () => { events.push({ type: 'close' }); toolbar!.hide(); },
      resize: () => { if (toolbar) layout(width); },
    });
    toolbar.update(model); toolbar.show(); layout(width); toolbar.focus();
  }
  // A real following Tab stop makes exiting the panel observable without browser chrome.
  const outside = document.createElement('button'); outside.id = 'outside'; outside.textContent = 'Outside'; document.body.append(outside);
}

async function mountController(options: FixtureOptions): Promise<void> {
  const file = { path: 'Synthetic.md', basename: 'Synthetic', extension: 'md' } as TFile;
  const target = { path: 'Concept.md', basename: 'Concept', extension: 'md' } as TFile;
  const markdownView = new MarkdownView();
  const app = {
    keymap: { pushScope: () => { scope.pushes++; }, popScope: () => { scope.pops++; } },
    workspace: { getLeavesOfType: () => [{ view: markdownView }] },
    vault: { getMarkdownFiles: () => [file, target], getFileByPath: (path: string) => [file, target].find(item => item.path === path) },
    metadataCache: {
      fileToLinktext: (item: TFile) => item.basename,
      getFirstLinkpathDest: (name: string) => [file, target].find(item => item.basename === name),
    },
  } as unknown as App;
  store = new PreferencesStore({ load: async () => null, save: async () => {} });
  await store.load();
  if (options.pinned) await store.setLayout({ kind: 'custom', pinned: options.pinned });
  const host = { app, store, t, controllers: new Set<EditorController>(), notify: (reason: string) => events.push({ type: 'notice', action: reason }) };
  const facet = defineLanguageFacet();
  const language = new Language(facet, parser.configure({ props: [languageDataProp.add(type => type.isTop ? facet : undefined)] }));
  const editor = document.querySelector<HTMLElement>('#editor')!; editor.style.width = `${width}px`;
  view = new EditorView({ parent: editor, state: EditorState.create({ doc: 'before text after', extensions: [
    language, revisionField, editorInfoField.init(() => ({ app, file, editor: markdownView.editor, hoverPopover: null })),
    editorLivePreviewField, EditorView.lineWrapping,
    ViewPlugin.define(editorView => controller = new EditorController(editorView, host)),
  ] }) });
  view.focus(); ensureSyntaxTree(view.state, view.state.doc.length, 200);
  view.dispatch({ selection: { anchor: 7, head: 11 } });
  await new Promise(requestAnimationFrame); controller!.show(true);
}

window.toolbarTest = {
  mount, layout,
  resizeEditor: width => { document.querySelector<HTMLElement>('#editor')!.style.width = `${width}px`; controller!.reconcile(); },
  inspect: () => ({ events, scope, text: view?.state.doc.toString() ?? '',
    selection: view ? [view.state.selection.main.anchor, view.state.selection.main.head] : [] }),
};
