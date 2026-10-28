import { StateField } from '@codemirror/state';
import type { MarkdownFileInfo } from 'obsidian';

// Only the public context fields are replaced; editor transactions and history stay real.
export const editorInfoField = StateField.define<MarkdownFileInfo>({
  create: () => { throw Error('Tests must supply their own file context'); },
  update: value => value,
});
export const editorLivePreviewField = StateField.define<boolean>({ create: () => true, update: value => value });
export class MarkdownView {}
