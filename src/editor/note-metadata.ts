import { parseFrontMatterAliases, TFile, type App, type CachedMetadata, type TAbstractFile } from 'obsidian';
import { canonicalAliases, type NoteRecord } from '../links/note-search';

export interface NoteMetadataEntry {
  readonly record: NoteRecord;
  readonly file: TFile;
  /** Name plus canonical aliases; compared to detect alias changes on the same path/file. */
  readonly signature: string;
}

export type MetadataResult =
  | { readonly kind: 'ready'; readonly epoch: number; readonly entries: readonly NoteMetadataEntry[] }
  | { readonly kind: 'pending' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error' };

export interface NoteMetadataSource {
  readonly currentEpoch: number;
  canReuseSnapshot(epoch: number): boolean;
  subscribe(listener: () => void): () => void;
  collect(signal: AbortSignal, isValid: () => boolean, scheduleYield: () => Promise<void>): Promise<MetadataResult>;
  recordFor(file: TFile): NoteRecord | null;
  destroy(): void;
}

/** Stable field signature used to reject candidates whose aliases changed without a path change. */
export function metadataSignature(record: NoteRecord): string {
  return `${record.name}\u0000${record.aliases.join('\u0000')}`;
}

function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

function readAliases(cache: CachedMetadata): { readonly ok: boolean; readonly aliases: readonly string[] } {
  let parsed: unknown;
  try {
    parsed = parseFrontMatterAliases(cache.frontmatter ?? null);
  } catch {
    return { ok: false, aliases: [] };
  }
  if (parsed === null || parsed === undefined) return { ok: true, aliases: [] };
  if (!Array.isArray(parsed)) return { ok: false, aliases: [] };
  return { ok: true, aliases: canonicalAliases(parsed) };
}

interface PendingFile {
  readonly file: TFile;
  readonly indexed?: { readonly data: string; readonly cache: CachedMetadata };
  verifying?: boolean;
}

/**
 * Host boundary for note metadata. It converts the Obsidian cache into copied records and tracks a
 * vault-wide invalidation epoch plus per-file pending content changes. Readiness is deliberately
 * conservative: the layout must be ready, no Markdown change may be awaiting a metadata re-index,
 * every Markdown file must have a cache, and the epoch must not change during collection; otherwise
 * the caller receives pending/stale and must not write. Notifications for pending files are verified
 * against disk because the host may coalesce edits or deliver an earlier notification late.
 */
export class NoteMetadata implements NoteMetadataSource {
  private epoch = 0;
  private destroyed = false;
  private readonly listeners = new Set<() => void>();
  /** Paths whose newest observed content change is not yet confirmed by a metadata re-index. */
  private readonly pending = new Map<string, PendingFile>();

  constructor(private readonly app: App) {}

  get currentEpoch(): number {
    return this.epoch;
  }

  canReuseSnapshot(epoch: number): boolean {
    return !this.destroyed && this.app.workspace.layoutReady && this.pending.size === 0 && this.epoch === epoch;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Bump the epoch, notify current sessions, and leave pending updates untouched. */
  invalidate(): void {
    this.touch();
  }

  fileModified(file: TFile): void {
    if (!isMarkdownPath(file.path)) return;
    this.pending.set(file.path, { file });
    this.touch();
  }

  /**
   * A rename preserves the file's indexed content, and the minimum SDK documents that renaming does
   * not emit `metadataCache.changed`. So move any outstanding wait from the old path (or directory
   * subtree) to the new path instead of adding a new wait that could never be confirmed.
   */
  fileRenamed(oldPath: string, newPath: string): void {
    const prefix = `${oldPath}/`;
    for (const [path, entry] of [...this.pending]) {
      if (path !== oldPath && !path.startsWith(prefix)) continue;
      const target = newPath + path.slice(oldPath.length);
      this.pending.delete(path);
      if (!isMarkdownPath(target)) continue;
      const moved = { file: entry.file, indexed: entry.indexed };
      this.pending.set(target, moved);
      void this.verifyPending(target, moved);
    }
    this.touch();
  }

  fileDeleted(file: TAbstractFile): void {
    if (file instanceof TFile) {
      if (this.pending.get(file.path)?.file === file) this.pending.delete(file.path);
    } else {
      const prefix = `${file.path}/`;
      for (const path of this.pending.keys()) if (path.startsWith(prefix)) this.pending.delete(path);
    }
    this.touch();
  }

  fileChanged(file: TFile, data: string, cache: CachedMetadata): void {
    const path = file.path;
    if (!isMarkdownPath(path)) return;
    if (this.pending.get(path)?.file === file) {
      const entry = { file, indexed: { data, cache } };
      this.pending.set(path, entry);
      void this.verifyPending(path, entry);
    }
    this.touch();
  }

  private async verifyPending(path: string, entry: PendingFile): Promise<void> {
    const { file, indexed } = entry;
    if (!indexed || entry.verifying) return;
    entry.verifying = true;
    try {
      const current = await this.app.vault.read(file);
      if (this.destroyed || this.pending.get(path) !== entry || file.path !== path ||
          this.app.vault.getFileByPath(path) !== file) return;
      if (current !== indexed.data) {
        this.pending.set(path, { file });
        return;
      }
      if (this.app.metadataCache.getFileCache(file) !== indexed.cache) return;
    } catch {
      // Keep the notification so the next search can retry a transient read failure.
      return;
    } finally {
      entry.verifying = false;
    }
    this.pending.delete(path);
    this.touch();
  }

  private touch(): void {
    if (this.destroyed) return;
    this.epoch++;
    for (const listener of [...this.listeners]) listener();
  }

  recordFor(file: TFile): NoteRecord | null {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return null;
      const aliases = readAliases(cache);
      if (!aliases.ok) return null;
      return { path: file.path, name: file.basename, aliases: aliases.aliases };
    } catch {
      return null;
    }
  }

  async collect(signal: AbortSignal, isValid: () => boolean, scheduleYield: () => Promise<void>): Promise<MetadataResult> {
    if (this.destroyed || signal.aborted || !isValid()) return { kind: 'cancelled' };
    if (!this.app.workspace.layoutReady) return { kind: 'pending' };
    // An unconfirmed content change can leave an older non-null cache, so never report ready
    // until a metadata re-index has confirmed every observed modification.
    if (this.pending.size > 0) {
      for (const [path, entry] of this.pending) void this.verifyPending(path, entry);
      return { kind: 'pending' };
    }
    const startEpoch = this.epoch;
    let files: TFile[];
    try {
      files = this.app.vault.getMarkdownFiles();
    } catch {
      return { kind: 'error' };
    }
    const entries: NoteMetadataEntry[] = [];
    for (let index = 0; index < files.length; index++) {
      if (index > 0 && index % 500 === 0) {
        await scheduleYield();
        if (signal.aborted || !isValid() || this.destroyed) return { kind: 'cancelled' };
        if (this.epoch !== startEpoch) return { kind: 'stale' };
      }
      const file = files[index]!;
      let cache: CachedMetadata | null;
      try {
        cache = this.app.metadataCache.getFileCache(file);
      } catch {
        return { kind: 'error' };
      }
      if (!cache) return { kind: 'pending' };
      const aliases = readAliases(cache);
      if (!aliases.ok) return { kind: 'error' };
      const record: NoteRecord = { path: file.path, name: file.basename, aliases: aliases.aliases };
      entries.push({ record, file, signature: metadataSignature(record) });
    }
    if (signal.aborted || !isValid() || this.destroyed) return { kind: 'cancelled' };
    if (this.epoch !== startEpoch) return { kind: 'stale' };
    return { kind: 'ready', epoch: startEpoch, entries };
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    this.pending.clear();
  }
}
