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
