import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { sameSelectionSession, type SelectionSnapshot } from '../src/editor/context';

const file = { path: 'note.md' } as TFile;

function snapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return { file, path: 'note.md', revision: 1, anchor: 2, head: 6, selectionLength: 4, lines: [], ...overrides };
}

describe('selection session identity', () => {
  it('treats a freshly captured snapshot of the same selection as the same session', () => {
    expect(sameSelectionSession(snapshot(), snapshot())).toBe(true);
  });
  it.each([
    ['selection', { anchor: 3 }],
    ['revision', { revision: 2 }],
    ['path', { path: 'other.md' }],
    ['file instance', { file: { path: 'note.md' } as TFile }],
  ])('rejects a different %s even when the path is unchanged', (_label, change) => {
    expect(sameSelectionSession(snapshot(), snapshot(change))).toBe(false);
  });
  it('rejects a missing session', () => {
    expect(sameSelectionSession(null, snapshot())).toBe(false);
  });
});
