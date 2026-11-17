// Pure note matching rules for the note picker and quick links. This module never imports
// Obsidian, the UI or settings: it operates only on copied note records and plain strings so the
// same rules drive both the picker and the quick-link decision.

export type MatchKind =
  | 'nameExact'
  | 'aliasExact'
  | 'namePrefix'
  | 'aliasPrefix'
  | 'nameContains'
  | 'aliasContains'
  | 'pathContains';

export interface NoteRecord {
  /** Original vault-relative path, including the `.md` extension. */
  readonly path: string;
  /** File basename without the extension. */
  readonly name: string;
  /** Valid, trimmed aliases in canonical order (see canonicalAliases). */
  readonly aliases: readonly string[];
}

export interface NoteMatch {
  readonly path: string;
  readonly priority: 0 | 1 | 2 | 3;
  readonly kind: MatchKind;
  readonly matchedAlias?: string;
}

/** Comparisons use fixed UTF-16 code-unit order, never locale-aware collation. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Query key: trim then fixed lowercase, independent of the system locale. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Convert raw alias values from the host cache into valid aliases: keep strings only, trim,
 * drop empty values, deduplicate by normalized key, and keep the smallest raw value per key.
 * The result is ordered by normalized key so display and matching are deterministic.
 */
export function canonicalAliases(values: readonly unknown[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const current = byKey.get(key);
    if (current === undefined || compareStrings(trimmed, current) < 0) byKey.set(key, trimmed);
  }
  return [...byKey.keys()].sort(compareStrings).map(key => byKey.get(key)!);
}

function findAlias(aliases: readonly string[], predicate: (key: string) => boolean): string | undefined {
  for (const alias of aliases) if (predicate(alias.trim().toLowerCase())) return alias;
  return undefined;
}

/** Best match for one file and a non-empty query key, or null when nothing matches. */
export function matchNote(note: NoteRecord, queryKey: string): NoteMatch | null {
  if (!queryKey) return null;
  const key = nameKey(note.name);
  if (key === queryKey) return { path: note.path, priority: 0, kind: 'nameExact' };
  const aliasExact = findAlias(note.aliases, alias => alias === queryKey);
  if (aliasExact !== undefined) return { path: note.path, priority: 1, kind: 'aliasExact', matchedAlias: aliasExact };
  if (key.startsWith(queryKey)) return { path: note.path, priority: 2, kind: 'namePrefix' };
  const aliasPrefix = findAlias(note.aliases, alias => alias.startsWith(queryKey));
  if (aliasPrefix !== undefined) return { path: note.path, priority: 2, kind: 'aliasPrefix', matchedAlias: aliasPrefix };
  if (key.includes(queryKey)) return { path: note.path, priority: 3, kind: 'nameContains' };
  const aliasContains = findAlias(note.aliases, alias => alias.includes(queryKey));
  if (aliasContains !== undefined) return { path: note.path, priority: 3, kind: 'aliasContains', matchedAlias: aliasContains };
  if (note.path.toLowerCase().includes(queryKey)) return { path: note.path, priority: 3, kind: 'pathContains' };
  return null;
}

/** Same priority: original full path in UTF-16 order. */
export function compareMatches(a: NoteMatch, b: NoteMatch): number {
  return a.priority - b.priority || compareStrings(a.path, b.path);
}

/** All matches for the query, sorted. Empty queries return no matches (see path order instead). */
export function searchRecords(records: readonly NoteRecord[], queryKey: string): readonly NoteMatch[] {
  if (!queryKey) return [];
  const matches: NoteMatch[] = [];
  for (const record of records) {
    const match = matchNote(record, queryKey);
    if (match) matches.push(match);
  }
  return matches.sort(compareMatches);
}

/** Records ordered by original path for an empty query. */
export function sortRecordsByPath(records: readonly NoteRecord[]): readonly NoteRecord[] {
  return [...records].sort((a, b) => compareStrings(a.path, b.path));
}

/** Exact target paths (priority 0 or 1), deduplicated across files. Never pass a truncated page. */
export function exactTargetPaths(matches: readonly NoteMatch[], queryKey: string): readonly string[] {
  if (!queryKey) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const match of matches) {
    if ((match.priority === 0 || match.priority === 1) && !seen.has(match.path)) {
      seen.add(match.path);
      paths.push(match.path);
    }
  }
  return paths;
}
