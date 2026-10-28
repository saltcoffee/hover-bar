import { EditorSelection, EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { defineLanguageFacet, ensureSyntaxTree, Language, languageDataProp } from '@codemirror/language';
import { history } from '@codemirror/commands';
import { parser, Table } from '@lezer/markdown';
import type { App, Editor, MarkdownFileInfo, TFile } from 'obsidian';
import { capture, revisionField } from '../../src/editor/context';
import { PreferencesStore } from '../../src/settings/store';
import { editorInfoField, editorLivePreviewField, MarkdownView } from './obsidian';

interface Options {
  from?: number; to?: number; reverse?: boolean; live?: boolean; mode?: 'source' | 'preview';
  readOnly?: boolean; editable?: Extension; composing?: boolean; pending?: boolean; multiple?: boolean;
}

export async function selectionFixture(text = 'word', options: Options = {}) {
  const file = { path: 'test.md', basename: 'test', extension: 'md' } as TFile;
  const editor = {} as Editor;
  const hostView = Object.assign(new MarkdownView(), { editor, getMode: () => options.mode ?? 'source' });
  const app = { workspace: { getLeavesOfType: () => [{ view: hostView }] } } as unknown as App;
  const data = defineLanguageFacet();
  const language = new Language(data, parser.configure([Table, { props: [languageDataProp.add({ Document: data })] }]));
  const from = options.from ?? 0, to = options.to ?? text.length;
  let state = EditorState.create({ doc: text,
    selection: options.multiple ? EditorSelection.create([EditorSelection.cursor(0), EditorSelection.range(2, 4)])
      : EditorSelection.single(options.reverse ? to : from, options.reverse ? from : to),
    extensions: [revisionField, history(), editorInfoField.init(() => ({ file, editor }) as MarkdownFileInfo),
      editorLivePreviewField.init(() => options.live ?? true), EditorState.allowMultipleSelections.of(true),
      EditorState.readOnly.of(options.readOnly ?? false), ...(options.editable ? [options.editable] : []),
      ...(!options.pending ? [language] : [])],
  });
  if (!options.pending) ensureSyntaxTree(state, state.doc.length, 200);
  let dispatches = 0;
  const view = {
    get state() { return state; }, composing: options.composing ?? false,
    dispatch(spec: TransactionSpec) { dispatches++; state = state.update(spec).state; },
  } as unknown as EditorView;
  const store = new PreferencesStore({ load: async () => null, save: async () => {} });
  await store.load();
  return { view, file, app, store, hostView, capture: () => capture(view, app, store), get dispatches() { return dispatches; } };
}
