import { describe, expect, it } from 'vitest';
import {
  canonicalAliases, compareMatches, exactTargetPaths, matchNote, normalizeQuery,
  searchRecords, searchTop, sortRecordsByPath, type NoteRecord,
} from '../src/links/note-search';

const records: readonly NoteRecord[] = [
  { path: 'work/A.md', name: 'A', aliases: ['项目甲'] },
  { path: 'archive/B.md', name: 'B', aliases: ['A', 'ProjectA'] },
  { path: 'work/Control.md', name: 'Control', aliases: ['A'] },
  { path: 'archive/Alpha.md', name: 'Alpha', aliases: [] },
  { path: 'work/Atlas.md', name: 'Atlas', aliases: [] },
  { path: 'work/C.md', name: 'C', aliases: ['APlan'] },
  { path: 'A-zone/Notes.md', name: 'Notes', aliases: [] },
];

describe('note search normalization and aliases', () => {
  it('normalizes queries with trim and locale-independent lowercase', () => {
    expect(normalizeQuery('  A  ')).toBe('a');
    expect(normalizeQuery('İstanbul')).toBe('i̇stanbul');
  });
  it('keeps only valid aliases, deduplicates by key, and picks the smallest raw value deterministically', () => {
    expect(canonicalAliases([' A ', 'a', '  ', 'ProjectA', 5, null, 'b'])).toEqual(['A', 'b', 'ProjectA']);
    expect(canonicalAliases([])).toEqual([]);
  });
});

describe('note matching priorities', () => {
  it('assigns name exact, alias exact, name prefix, and alias prefix in order', () => {
    expect(matchNote({ path: 'x/A.md', name: 'A', aliases: [] }, 'a')).toMatchObject({ priority: 0, kind: 'nameExact' });
    expect(matchNote({ path: 'x/B.md', name: 'B', aliases: ['A'] }, 'a')).toMatchObject({ priority: 1, kind: 'aliasExact', matchedAlias: 'A' });
    expect(matchNote({ path: 'x/Ab.md', name: 'Ab', aliases: [] }, 'a')).toMatchObject({ priority: 2, kind: 'namePrefix' });
    expect(matchNote({ path: 'x/B.md', name: 'B', aliases: ['Ab'] }, 'a')).toMatchObject({ priority: 2, kind: 'aliasPrefix', matchedAlias: 'Ab' });
  });
  it('prefers an alias exact hit over a lower-priority name prefix hit on the same file', () => {
    expect(matchNote({ path: 'x/Alpha.md', name: 'Alpha', aliases: ['A'] }, 'a')).toMatchObject({ priority: 1, kind: 'aliasExact', matchedAlias: 'A' });
  });
  it('uses name before alias at the same priority and falls back to contains and path', () => {
    expect(matchNote({ path: 'x/Ab.md', name: 'Ab', aliases: ['Ac'] }, 'a')).toMatchObject({ kind: 'namePrefix' });
    expect(matchNote({ path: 'x/Foo.md', name: 'Foo', aliases: ['bar'] }, 'ar')).toMatchObject({ priority: 3, kind: 'aliasContains', matchedAlias: 'bar' });
    expect(matchNote({ path: 'x/Foo.md', name: 'Foo', aliases: [] }, 'oo')).toMatchObject({ priority: 3, kind: 'nameContains' });
    expect(matchNote({ path: 'dir/foo.md', name: 'Foo', aliases: [] }, 'dir')).toMatchObject({ priority: 3, kind: 'pathContains' });
    expect(matchNote({ path: 'x/Foo.md', name: 'Foo', aliases: [] }, 'zzz')).toBeNull();
  });
});

describe('deterministic ordering and exact targets', () => {
  it('orders the fixed example by priority and then by original path', () => {
    const matches = searchRecords(records, normalizeQuery(' A '));
    expect(matches.map(match => match.path)).toEqual([
      'work/A.md', 'archive/B.md', 'work/Control.md',
      'archive/Alpha.md', 'work/Atlas.md', 'work/C.md', 'A-zone/Notes.md',
    ]);
  });
  it('produces the same result regardless of input order', () => {
    const shuffled = [...records].reverse();
    expect(searchRecords(shuffled, 'a').map(match => match.path))
      .toEqual(searchRecords(records, 'a').map(match => match.path));
  });
  it('keeps only exact name or alias targets, deduplicated across files', () => {
    const matches = searchRecords(records, 'a');
    expect(exactTargetPaths(matches, 'a')).toEqual(['work/A.md', 'archive/B.md', 'work/Control.md']);
  });
  it('counts a file once even when its name and alias both match exactly', () => {
    const matches = searchRecords([{ path: 'b/A.md', name: 'A', aliases: ['a'] }], 'a');
    expect(matches).toHaveLength(1);
    expect(exactTargetPaths(matches, 'a')).toEqual(['b/A.md']);
  });
  it('orders empty queries by path and returns no matches for them', () => {
    expect(searchRecords(records, '').length).toBe(0);
    expect(sortRecordsByPath(records).map(record => record.path)).toEqual([...records.map(record => record.path)].sort());
  });
  it('compares same-priority matches by plain UTF-16 path order', () => {
    const a = { path: 'A.md', priority: 3 as const, kind: 'pathContains' as const };
    const b = { path: 'a.md', priority: 3 as const, kind: 'pathContains' as const };
    expect(compareMatches(a, b)).toBeLessThan(0);
  });
});

describe('bounded search parity with full search', () => {
  it('matches searchRecords exactly across edge cases, Chinese, duplicates, and 49/50/51 boundaries', () => {
    const corpus: NoteRecord[] = [
      ...Array.from({ length: 52 }, (_, i) => ({
        path: `dir/${String(52 - i).padStart(2, '0')}.md`,
        name: `Note${i}`,
        aliases: [`Term${String(i).padStart(2, '0')}`, i % 2 === 0 ? '项目' : '专题'],
      })),
      { path: 'z/LateExact.md', name: 'Term', aliases: ['Dup', 'dup'] },
      { path: 'a/EarlyContains.md', name: 'Other', aliases: ['SomeTermHere'] },
      { path: 'm/Chinese.md', name: '项目计划', aliases: ['TermA', '项'] },
    ];
    for (const raw of ['', 'term', 'TERM', '项目', '项', 'dup', 'dir/4', 'lateexact', 'zzz']) {
      const q = normalizeQuery(raw);
      const full = searchRecords(corpus, q);
      const top = searchTop(corpus, q, 50);
      expect(top.matchedCount).toBe(full.length);
      expect(top.items).toEqual(full.slice(0, 50));
    }
    for (const count of [49, 50, 51]) {
      const subset = Array.from({ length: count }, (_, i) => ({
        path: `p/${String(count - i).padStart(2, '0')}.md`,
        name: `K${i}`,
        aliases: ['Shared'],
      }));
      const q = 'shared';
      const full = searchRecords(subset, q);
      const top = searchTop(subset, q, 50);
      expect(top.matchedCount).toBe(count);
      expect(top.items).toEqual(full.slice(0, 50));
    }
  });
});
