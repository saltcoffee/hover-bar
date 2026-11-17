import { StateField } from '@codemirror/state';
import type { MarkdownFileInfo } from 'obsidian';

// Only the public context fields are replaced; editor transactions and history stay real.
export const editorInfoField = StateField.define<MarkdownFileInfo>({
  create: () => { throw Error('Tests must supply their own file context'); },
  update: value => value,
});
export const editorLivePreviewField = StateField.define<boolean>({ create: () => true, update: value => value });
export class MarkdownView {}
export class TFile {}
export class TFolder {}
export function setIcon(): void {}
export class Scope {
  readonly handlers = new Map<string, (event: KeyboardEvent) => unknown>();
  register(_modifiers: unknown, key: string, callback: (event: KeyboardEvent) => unknown): void { this.handlers.set(key, callback); }
}
// Minimal frontmatter alias reader matching the public host helper semantics used by the adapter.
export function parseFrontMatterAliases(frontmatter: unknown): string[] | null {
  if (!frontmatter || typeof frontmatter !== 'object') return null;
  const value = (frontmatter as Record<string, unknown>).aliases;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return null;
}
