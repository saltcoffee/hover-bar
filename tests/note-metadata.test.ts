import { describe, expect, it } from 'vitest';
import { TFile, type App, type CachedMetadata } from 'obsidian';
import { metadataSignature, NoteMetadata } from '../src/editor/note-metadata';

function file(path: string): TFile {
  const name = path.split('/').pop()!.replace(/\.md$/, '');
  return Object.assign(new TFile(), { path, basename: name, extension: path.split('.').at(-1) });
}
function cache(frontmatter?: unknown): CachedMetadata {
  return { frontmatter } as CachedMetadata;
}
function appWith(files: readonly TFile[], caches: ReadonlyMap<string, CachedMetadata | null>, layoutReady = true,
  read: (file: TFile) => Promise<string> = async () => ''): App {
  return {
    workspace: { layoutReady },
    vault: { getMarkdownFiles: () => [...files], getFileByPath: (path: string) => files.find(file => file.path === path) ?? null, read },
    metadataCache: { getFileCache: (target: TFile) => caches.get(target.path) ?? null },
  } as unknown as App;
}

const never = () => new Promise<void>(() => {});
const noYield = async () => {};

describe('note metadata adapter', () => {
  it('copies names and canonical aliases into records with a stable signature', async () => {
    const a = file('work/A.md');
    const caches = new Map([[a.path, cache({ aliases: [' A ', 'a', ''] })]]);
    const adapter = new NoteMetadata(appWith([a], caches));
    const result = await adapter.collect(new AbortController().signal, () => true, noYield);
    expect(result).toMatchObject({ kind: 'ready', epoch: 0 });
    if (result.kind !== 'ready') return;
    expect(result.entries[0]!.record).toEqual({ path: 'work/A.md', name: 'A', aliases: ['A'] });
    expect(result.entries[0]!.signature).toBe(metadataSignature(result.entries[0]!.record));
    adapter.destroy();
  });
  it('treats a missing cache as pending, never as no aliases', async () => {
    const a = file('A.md');
    const adapter = new NoteMetadata(appWith([a], new Map()));
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.destroy();
  });
  it('keeps a modified file pending until a metadata re-index confirms it', async () => {
    const a = file('A.md');
    const caches = new Map([[a.path, cache({ aliases: ['old'] })]]);
    const adapter = new NoteMetadata(appWith([a], caches));
    adapter.fileModified(a);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    const indexed = cache({ aliases: ['old', 'new'] });
    caches.set(a.path, indexed);
    adapter.fileChanged(a, '', indexed);
    await Promise.resolve();
    const result = await adapter.collect(new AbortController().signal, () => true, noYield);
    expect(result).toMatchObject({ kind: 'ready' });
    if (result.kind === 'ready') expect(result.entries[0]!.record.aliases).toEqual(['new', 'old']);
    adapter.destroy();
  });
  it('keeps waiting when an older re-index notification cannot cover a newer modification', async () => {
    const a = file('A.md');
    const indexed = cache();
    const caches = new Map([[a.path, indexed]]);
    const adapter = new NoteMetadata(appWith([a], caches, true, async () => 'v2'));
    adapter.fileModified(a); // M1
    adapter.fileModified(a); // M2
    adapter.fileChanged(a, 'v1', indexed);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.fileChanged(a, 'v2', indexed);
    await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('does not add a wait for a plain rename of a confirmed file', async () => {
    const a = file('old/A.md'), b = file('new/A.md');
    const caches = new Map([[a.path, cache()]]);
    const files = [a];
    const adapter = new NoteMetadata(appWith(files, caches));
    adapter.fileRenamed(a.path, b.path);
    files[0] = b; caches.set(b.path, cache());
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('migrates pending work for a renamed file to its new path', async () => {
    const a = file('old/A.md');
    const indexed = cache();
    const caches = new Map([[a.path, indexed]]);
    const adapter = new NoteMetadata(appWith([a], caches));
    adapter.fileModified(a);
    const oldPath = a.path;
    a.path = 'new/A.md';
    adapter.fileRenamed(oldPath, a.path);
    caches.set(a.path, indexed);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.fileChanged(a, '', indexed);
    await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('migrates pending children when a directory is renamed', async () => {
    const a = file('old/B.md');
    const indexed = cache();
    const caches = new Map([[a.path, indexed]]);
    const adapter = new NoteMetadata(appWith([a], caches));
    adapter.fileModified(a);
    a.path = 'new/B.md';
    adapter.fileRenamed('old', 'new');
    caches.set(a.path, indexed);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.fileChanged(a, '', indexed);
    await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('waits for layout readiness', async () => {    const adapter = new NoteMetadata(appWith([], new Map(), false));
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.destroy();
  });
  it('returns error when reading the cache throws', async () => {
    const a = file('A.md');
    const app = {
      workspace: { layoutReady: true }, vault: { getMarkdownFiles: () => [a] },
      metadataCache: { getFileCache: () => { throw Error('cache'); } },
    } as unknown as App;
    const adapter = new NoteMetadata(app);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'error' });
    adapter.destroy();
  });
  it('returns cancelled for an aborted task without reading anything', async () => {
    const adapter = new NoteMetadata(appWith([], new Map()));
    const controller = new AbortController(); controller.abort();
    await expect(adapter.collect(controller.signal, () => true, never)).resolves.toEqual({ kind: 'cancelled' });
    adapter.destroy();
  });
  it('returns stale when the epoch changes during a batched scan', async () => {
    const files = Array.from({ length: 501 }, (_, index) => file(`bench/${index}.md`));
    const caches = new Map(files.map(target => [target.path, cache()] as const));
    const adapter = new NoteMetadata(appWith(files, caches));
    const result = await adapter.collect(new AbortController().signal, () => true, async () => { adapter.invalidate(); });
    expect(result).toEqual({ kind: 'stale' });
    adapter.destroy();
  });
  it('ignores content changes to non-Markdown files', async () => {
    const adapter = new NoteMetadata(appWith([], new Map()));
    adapter.fileModified(file('assets/image.png'));
    adapter.fileModified(file('assets/new.pdf'));
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('clears pending work when a modified file is deleted', async () => {
    const a = file('A.md');
    const caches = new Map([[a.path, cache()]]);
    const adapter = new NoteMetadata(appWith([a], caches));
    adapter.fileModified(a);
    adapter.fileDeleted(a);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('reads one record on demand and reports unreadable files as null', () => {
    const a = file('A.md');
    const adapter = new NoteMetadata(appWith([a], new Map([[a.path, cache({ aliases: 'Solo' })]])));
    expect(adapter.recordFor(a)).toEqual({ path: 'A.md', name: 'A', aliases: ['Solo'] });
    expect(adapter.recordFor(file('missing.md'))).toBeNull();
    adapter.destroy();
  });
  it('allows snapshot reuse only while layout is ready, pending is empty, epoch matches, and adapter is alive', async () => {
    const a = file('A.md');
    const indexed = cache();
    const app = appWith([a], new Map([[a.path, indexed]]));
    const adapter = new NoteMetadata(app);
    expect(adapter.canReuseSnapshot(0)).toBe(true);
    expect(adapter.canReuseSnapshot(1)).toBe(false);
    expect(new NoteMetadata(appWith([], new Map(), false)).canReuseSnapshot(0)).toBe(false);
    adapter.fileModified(a);
    expect(adapter.canReuseSnapshot(adapter.currentEpoch)).toBe(false);
    adapter.fileChanged(a, '', indexed);
    await Promise.resolve();
    expect(adapter.canReuseSnapshot(adapter.currentEpoch)).toBe(true);
    const epoch = adapter.currentEpoch;
    adapter.destroy();
    expect(adapter.canReuseSnapshot(epoch)).toBe(false);
  });
  it('clears coalesced pending edits when changed content and cache match current disk content', async () => {
    const a = file('A.md');
    const c2 = cache({ aliases: ['v2'] });
    const c3 = cache({ aliases: ['v3'] });
    const caches = new Map([[a.path, c2]]);
    let diskContent = 'v2';
    const adapter = new NoteMetadata(appWith([a], caches, true, async () => diskContent));
    adapter.fileModified(a);
    adapter.fileModified(a);
    adapter.fileChanged(a, 'v2', c2);
    await Promise.resolve();
    const ready = await adapter.collect(new AbortController().signal, () => true, noYield);
    expect(ready).toMatchObject({ kind: 'ready' });

    diskContent = 'v3';
    adapter.fileModified(a);
    adapter.fileChanged(a, 'v2', c2); // A late duplicate cannot confirm v3.
    await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });

    caches.set(a.path, c3);
    adapter.fileChanged(a, 'v3', c3);
    await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({
      kind: 'ready', entries: [{ record: { aliases: ['v3'] } }],
    });
    adapter.destroy();
  });

  it('discards an in-flight content verification when a newer modification arrives before read resolves', async () => {
    const a = file('A.md');
    const c = cache({ aliases: ['v2'] });
    const caches = new Map([[a.path, c]]);
    let resolveRead!: (value: string) => void;
    const app = {
      workspace: { layoutReady: true },
      vault: {
        getMarkdownFiles: () => [a],
        getFileByPath: (p: string) => (p === a.path ? a : null),
        read: () => new Promise<string>(resolve => { resolveRead = resolve; }),
      },
      metadataCache: { getFileCache: (target: TFile) => caches.get(target.path) ?? null },
    } as unknown as App;
    const adapter = new NoteMetadata(app);
    adapter.fileModified(a);
    adapter.fileChanged(a, 'v2', c);
    adapter.fileModified(a);
    resolveRead('v2');
    await Promise.resolve(); await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.destroy();
  });
  it.each(['read', 'cache'] as const)('retries a transient %s error using the previous notification', async failure => {
    const a = file('A.md');
    const c = cache({ aliases: ['v2'] });
    let failing = true;
    const app = {
      workspace: { layoutReady: true },
      vault: {
        getMarkdownFiles: () => [a],
        getFileByPath: () => a,
        read: async () => { if (failing && failure === 'read') throw Error('disk'); return 'v2'; },
      },
      metadataCache: {
        getFileCache: () => { if (failing && failure === 'cache') throw Error('cache'); return c; },
      },
    } as unknown as App;
    const adapter = new NoteMetadata(app);
    adapter.fileModified(a);
    adapter.fileChanged(a, 'v2', c);
    await Promise.resolve();
    failing = false;
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });

  it('recovers when a directory moves after the only notification and before its read completes', async () => {
    const a = file('old/A.md');
    const indexed = cache();
    const caches = new Map([[a.path, indexed]]);
    let rejectOldRead!: (err: Error) => void;
    const adapter = new NoteMetadata(appWith([a], caches, true, file =>
      file.path === 'old/A.md' ? new Promise((_resolve, reject) => { rejectOldRead = reject; }) : Promise.resolve('current')));
    adapter.fileModified(a);
    adapter.fileChanged(a, 'current', indexed);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });

    a.path = 'new/A.md';
    caches.set(a.path, indexed);
    adapter.fileRenamed('old', 'new');
    rejectOldRead(Error('old path removed'));
    await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({
      kind: 'ready', entries: [{ record: { path: 'new/A.md' } }],
    });
    adapter.destroy();
  });

  it('keeps a same-path replacement pending after a notification for the former file', async () => {
    const a = file('A.md'), replacement = file('A.md');
    const indexed = cache();
    const adapter = new NoteMetadata(appWith([replacement], new Map([[a.path, indexed]])));
    adapter.fileModified(a);
    adapter.fileModified(replacement);
    adapter.fileChanged(a, '', indexed);
    adapter.fileDeleted(a);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.fileChanged(replacement, '', indexed);
    await Promise.resolve();
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({
      kind: 'ready', entries: [{ file: replacement }],
    });
    adapter.destroy();
  });
});
