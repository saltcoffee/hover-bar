import { StateField } from '@codemirror/state';
import type { Editor, MarkdownFileInfo } from 'obsidian';

// Replace only host APIs unavailable outside Obsidian; the UI and editor stay real.
export const editorInfoField = StateField.define<MarkdownFileInfo>({
  create: () => { throw Error('The browser fixture must supply a file context'); },
  update: value => value,
});
export const editorLivePreviewField = StateField.define<boolean>({ create: () => true, update: value => value });
export class MarkdownView { editor = {} as Editor; getMode(): string { return 'source'; } }
export class Scope { register(): void {} }
export function setIcon(element: HTMLElement, name: string): void { element.textContent = name.slice(0, 1); }
export function parseFrontMatterAliases(frontmatter: unknown): string[] | null {
  if (!frontmatter || typeof frontmatter !== 'object') return null;
  const value = (frontmatter as Record<string, unknown>).aliases;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return null;
}
