import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, TFolder, type App, type CachedMetadata, type PluginManifest, type TAbstractFile } from 'obsidian';
import HoverBarPlugin from '../src/main';

vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<typeof import('obsidian')>(),
  getLanguage: () => 'en',
  Notice: class { hide() {} setMessage() {} },
  Plugin: class {
    constructor(readonly app: App) {}
    loadData() { return Promise.resolve(null); }
    async saveData() {}
    register() {} registerEvent() {} registerEditorExtension() {} addSettingTab() {} addCommand() {}
  },
  PluginSettingTab: class {},
}));

type FileEvent = (file: TAbstractFile, oldPath?: string) => void;
type MetadataEvent = (file: TFile, data: string, cache: CachedMetadata) => void;
const plugins: HoverBarPlugin[] = [];
afterEach(() => { for (const plugin of plugins.splice(0)) plugin.onunload(); });

async function setup(path = 'Notes/A.md') {
  const note = Object.assign(new TFile(), { path, name: 'A.md', basename: 'A', extension: 'md' });
  const files = [note];
  const caches = new Map<string, CachedMetadata>([[path, {}]]);
  const vaultEvents = new Map<string, FileEvent>();
  const metadataEvents = new Map<string, MetadataEvent>();
  const app = {
    workspace: { layoutReady: true, on: vi.fn(), updateOptions: vi.fn() },
    vault: {
      on: (name: string, callback: FileEvent) => { vaultEvents.set(name, callback); },
      getMarkdownFiles: () => [...files],
      getFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
      read: async () => 'current',
    },
    metadataCache: {
      on: (name: string, callback: MetadataEvent) => { metadataEvents.set(name, callback); },
      getFileCache: (file: TFile) => caches.get(file.path) ?? null,
    },
  } as unknown as App;
  const plugin = new HoverBarPlugin(app, {} as PluginManifest);
  plugins.push(plugin);
  await plugin.onload();
  const collect = () => plugin['metadata'].collect(new AbortController().signal, () => true, async () => {});
  return { note, files, caches, vaultEvents, metadataEvents, collect };
}

describe('vault event file and directory boundaries', () => {
  it.each(['create', 'modify'])('keeps note search ready after a %s event for a .md-suffixed directory', async event => {
    const { vaultEvents, collect } = await setup();
    const folder = Object.assign(new TFolder(), { path: 'Archive.md', name: 'Archive.md', children: [] });
    vaultEvents.get(event)!(folder);
    await expect(collect()).resolves.toMatchObject({ kind: 'ready' });
  });

  it.each(['create', 'modify'])('waits for a real Markdown file to be indexed after %s', async event => {
    const { note, caches, vaultEvents, metadataEvents, collect } = await setup();
    vaultEvents.get(event)!(note);
    await expect(collect()).resolves.toEqual({ kind: 'pending' });
    metadataEvents.get('changed')!(note, 'current', caches.get(note.path)!);
    await Promise.resolve();
    await expect(collect()).resolves.toMatchObject({ kind: 'ready' });
  });

  it('keeps non-Markdown files out of the pending note set', async () => {
    const { vaultEvents, collect } = await setup();
    const attachment = Object.assign(new TFile(), { path: 'image.png', name: 'image.png', basename: 'image', extension: 'png' });
    vaultEvents.get('create')!(attachment);
    vaultEvents.get('modify')!(attachment);
    await expect(collect()).resolves.toMatchObject({ kind: 'ready' });
  });

  it('migrates a pending child when a .md-suffixed directory is renamed', async () => {
    const { note, caches, vaultEvents, metadataEvents, collect } = await setup('Archive.md/A.md');
    vaultEvents.get('modify')!(note);
    const folder = Object.assign(new TFolder(), { path: 'Archive', name: 'Archive', children: [note] });
    note.path = 'Archive/A.md';
    caches.set(note.path, {});
    vaultEvents.get('rename')!(folder, 'Archive.md');
    await expect(collect()).resolves.toEqual({ kind: 'pending' });
    metadataEvents.get('changed')!(note, 'current', caches.get(note.path)!);
    await Promise.resolve();
    await expect(collect()).resolves.toMatchObject({ kind: 'ready' });
  });

  it('clears pending children when their directory is deleted', async () => {
    const { note, files, vaultEvents, collect } = await setup('Archive.md/A.md');
    vaultEvents.get('modify')!(note);
    const folder = Object.assign(new TFolder(), { path: 'Archive.md', name: 'Archive.md', children: [] });
    files.splice(0);
    vaultEvents.get('delete')!(folder);
    await expect(collect()).resolves.toMatchObject({ kind: 'ready' });
  });

  it('forwards folder rename/delete and same-path file replacement create events to active controllers', async () => {
    const { note } = await setup('Notes/A.md');
    const controller = {
      handleExternalFileChange: vi.fn(),
      handleExternalFileCreate: vi.fn(),
      destroy: vi.fn(),
    };
    const vaultE = new Map<string, FileEvent>();
    const app = {
      workspace: { layoutReady: true, on: vi.fn(), updateOptions: vi.fn() },
      vault: { on: (name: string, cb: FileEvent) => { vaultE.set(name, cb); }, getMarkdownFiles: () => [note] },
      metadataCache: { on: vi.fn(), getFileCache: () => ({}) },
    } as unknown as App;
    const plugin = new HoverBarPlugin(app, {} as PluginManifest);
    plugins.push(plugin);
    await plugin.onload();
    plugin['controllers'].add(controller as never);

    const folder = Object.assign(new TFolder(), { path: 'Notes-new', name: 'Notes-new', children: [] });
    vaultE.get('rename')!(folder, 'Notes');
    expect(controller.handleExternalFileChange).toHaveBeenCalledWith(folder, 'Notes');
    vaultE.get('delete')!(folder);
    expect(controller.handleExternalFileChange).toHaveBeenCalledWith(folder);
    const replacement = Object.assign(new TFile(), { path: 'Notes/A.md', name: 'A.md', basename: 'A', extension: 'md' });
    vaultE.get('create')!(replacement);
    expect(controller.handleExternalFileCreate).toHaveBeenCalledWith(replacement);
  });
});
