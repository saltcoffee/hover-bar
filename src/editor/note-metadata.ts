import { parseFrontMatterAliases, type App, type CachedMetadata, type TFile } from 'obsidian';
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

/**
 * Host boundary for note metadata. It converts the Obsidian cache into copied records and tracks a
 * vault-wide invalidation epoch plus per-file pending content changes. Readiness is deliberately
 * conservative: the layout must be ready, no Markdown change may be awaiting a metadata re-index,
 * every Markdown file must have a cache, and the epoch must not change during collection; otherwise
 * the caller receives pending/stale and must not write. The exact host update-confirmation protocol
 * still requires validation in a real Obsidian install (see the 0.1.7 development notes).
 */
export class NoteMetadata implements NoteMetadataSource {
  private epoch = 0;
  private destroyed = false;
  private readonly listeners = new Set<() => void>();
  /** Paths whose newest observed content change is not yet confirmed by a metadata re-index. */
  private readonly pending = new Map<string, number>();

  constructor(private readonly app: App) {}

  get currentEpoch(): number {
    return this.epoch;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Bump the epoch, notify current sessions, and leave pending updates untouched. */
  invalidate(): void {
    this.touch();
  }

  fileCreated(path: string): void {
    if (!isMarkdownPath(path)) return;
    this.pending.set(path, (this.pending.get(path) ?? 0) + 1);
    this.touch();
  }

  fileModified(path: string): void {
    if (!isMarkdownPath(path)) return;
    this.pending.set(path, (this.pending.get(path) ?? 0) + 1);
    this.touch();
  }

  /**
   * A rename preserves the file's indexed content, and the minimum SDK documents that renaming does
   * not emit `metadataCache.changed`. So move any outstanding wait from the old path (or directory
   * subtree) to the new path instead of adding a new wait that could never be confirmed.
   */
  fileRenamed(oldPath: string, newPath: string): void {
    this.migratePending(oldPath, newPath);
    this.touch();
  }

  private migratePending(oldPath: string, newPath: string): void {
    const direct = this.pending.get(oldPath);
    if (direct !== undefined) {
      this.pending.delete(oldPath);
      if (isMarkdownPath(newPath)) this.pending.set(newPath, direct);
    }
    const prefix = `${oldPath}/`;
    for (const key of [...this.pending.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const count = this.pending.get(key)!;
      this.pending.delete(key);
      const target = `${newPath}/${key.slice(prefix.length)}`;
      if (isMarkdownPath(target)) this.pending.set(target, count);
    }
  }

  fileDeleted(path: string): void {
    this.pending.delete(path);
    const prefix = `${path}/`;
    for (const key of [...this.pending.keys()]) if (key.startsWith(prefix)) this.pending.delete(key);
    this.touch();
  }

  /**
   * A metadata re-index confirms exactly one observed content change for this file. Keeping a count
   * means an older notification (changed for M1) cannot clear the wait for a newer modification (M2)
   * still awaiting its own re-index. The host's exact ordering must still be validated for real.
   */
  fileChanged(path: string): void {
    if (!isMarkdownPath(path)) return;
    const count = this.pending.get(path);
    if (count !== undefined) {
      if (count <= 1) this.pending.delete(path);
      else this.pending.set(path, count - 1);
    }
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
    if (this.pending.size > 0) return { kind: 'pending' };
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
  }
}
