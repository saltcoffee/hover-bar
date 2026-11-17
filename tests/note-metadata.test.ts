import { describe, expect, it } from 'vitest';
import type { App, CachedMetadata, TFile } from 'obsidian';
import { metadataSignature, NoteMetadata } from '../src/editor/note-metadata';

function file(path: string): TFile {
  const name = path.split('/').pop()!.replace(/\.md$/, '');
  return { path, basename: name, extension: 'md' } as TFile;
}
function cache(frontmatter?: unknown): CachedMetadata {
  return { frontmatter } as CachedMetadata;
}
function appWith(files: readonly TFile[], caches: ReadonlyMap<string, CachedMetadata | null>, layoutReady = true): App {
  return {
    workspace: { layoutReady },
    vault: { getMarkdownFiles: () => [...files] },
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
    adapter.fileModified(a.path);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    caches.set(a.path, cache({ aliases: ['old', 'new'] }));
    adapter.fileChanged(a.path);
    const result = await adapter.collect(new AbortController().signal, () => true, noYield);
    expect(result).toMatchObject({ kind: 'ready' });
    if (result.kind === 'ready') expect(result.entries[0]!.record.aliases).toEqual(['new', 'old']);
    adapter.destroy();
  });
  it('keeps waiting when an older re-index notification cannot cover a newer modification', async () => {
    const a = file('A.md');
    const caches = new Map([[a.path, cache()]]);
    const adapter = new NoteMetadata(appWith([a], caches));
    adapter.fileModified(a.path); // M1
    adapter.fileModified(a.path); // M2
    adapter.fileChanged(a.path); // changed for M1 only
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.fileChanged(a.path); // changed for M2
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
    const a = file('old/A.md'), b = file('new/A.md');
    const caches = new Map([[a.path, cache()]]);
    const files = [a];
    const adapter = new NoteMetadata(appWith(files, caches));
    adapter.fileModified(a.path);
    adapter.fileRenamed(a.path, b.path);
    files[0] = b; caches.set(b.path, cache());
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.fileChanged(b.path);
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('migrates pending children when a directory is renamed', async () => {
    const a = file('old/B.md'), b = file('new/B.md');
    const caches = new Map([[a.path, cache()]]);
    const files = [a];
    const adapter = new NoteMetadata(appWith(files, caches));
    adapter.fileModified(a.path);
    adapter.fileRenamed('old', 'new');
    files[0] = b; caches.set(b.path, cache());
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toEqual({ kind: 'pending' });
    adapter.fileChanged(b.path);
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
    adapter.fileModified('assets/image.png');
    adapter.fileCreated('assets/new.pdf');
    await expect(adapter.collect(new AbortController().signal, () => true, noYield)).resolves.toMatchObject({ kind: 'ready' });
    adapter.destroy();
  });
  it('clears pending work when a modified file is deleted', async () => {
    const a = file('A.md');
    const caches = new Map([[a.path, cache()]]);
    const adapter = new NoteMetadata(appWith([a], caches));
    adapter.fileModified(a.path);
    adapter.fileDeleted(a.path);
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
});
