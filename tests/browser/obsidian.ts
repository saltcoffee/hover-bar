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
interface BrowserElementInfo { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null>; type?: string; placeholder?: string; value?: string; prepend?: boolean }
if (typeof Node !== 'undefined' && !('createEl' in Node.prototype)) {
  const createEl = function (this: Node, tag: string, options?: BrowserElementInfo | string, callback?: (el: HTMLElement) => void): HTMLElement {
    const doc = this.ownerDocument ?? (this as Document);
    const element = doc.createElement(tag);
    if (typeof options === 'string') element.className = options;
    else if (options) {
      if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
      if (options.text !== undefined) element.textContent = options.text;
      if (options.type !== undefined) (element as HTMLInputElement).type = options.type;
      if (options.placeholder !== undefined) (element as HTMLInputElement).placeholder = options.placeholder;
      if (options.value !== undefined) (element as HTMLInputElement).value = options.value;
      if (options.attr) {
        for (const [key, value] of Object.entries(options.attr)) if (value !== null) element.setAttribute(key, String(value));
      }
    }
    if (typeof options === 'object' && options?.prepend && this.firstChild) this.insertBefore(element, this.firstChild);
    else this.appendChild(element);
    callback?.(element);
    return element;
  };
  Object.assign(Node.prototype, {
    createEl,
    createDiv(this: Node, options?: BrowserElementInfo | string, callback?: (el: HTMLDivElement) => void) { return createEl.call(this, 'div', options, callback as ((el: HTMLElement) => void) | undefined); },
    createSpan(this: Node, options?: BrowserElementInfo | string, callback?: (el: HTMLSpanElement) => void) { return createEl.call(this, 'span', options, callback as ((el: HTMLElement) => void) | undefined); },
  });
}
export function parseFrontMatterAliases(frontmatter: unknown): string[] | null {
  if (!frontmatter || typeof frontmatter !== 'object') return null;
  const value = (frontmatter as Record<string, unknown>).aliases;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return null;
}
