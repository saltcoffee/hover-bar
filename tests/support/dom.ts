// Minimal native DOM boundary for settings unit tests. Real focus, layout and keyboard
// behavior are verified separately in Obsidian, not inferred from this adapter.
interface ElementOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  type?: string;
  placeholder?: string;
  value?: string;
  prepend?: boolean;
}

export class TestElement extends EventTarget {
  children: TestElement[] = [];
  parentElement: TestElement | null = null;
  className = ''; dataset: Record<string, string> = {}; attributes = new Map<string, string>();
  hidden = false; disabled = false; checked = false; type = ''; tabIndex = 0; value = ''; placeholder = ''; id = ''; htmlFor = '';
  scrollTop = 0;
  readonly style = { setProperty() {}, removeProperty() {} };
  private text = '';
  constructor(readonly tagName: string, readonly ownerDocument: TestDocument) { super(); }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  get classList() {
    return {
      add: (...names: string[]) => { this.className = [...new Set([...this.className.split(' '), ...names])].filter(Boolean).join(' '); },
      remove: (...names: string[]) => { this.className = this.className.split(' ').filter(name => name && !names.includes(name)).join(' '); },
    };
  }
  get isConnected(): boolean { return this === this.ownerDocument.body || !!this.parentElement?.isConnected; }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  removeAttribute(key: string): void { this.attributes.delete(key); }
  getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
  contains(node: TestElement | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  focus(): void { if (this.isConnected && !this.disabled && !this.hidden) this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { top: 0, bottom: 36, left: 0, right: 36, width: 36, height: 36 }; }
  empty(): void { this.replaceChildren(); }
  createEl(tag: string, options?: ElementOptions | string, callback?: (el: TestElement) => void): TestElement {
    const element = this.ownerDocument.createElement(tag);
    if (typeof options === 'string') element.className = options;
    else if (options) {
      if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
      if (options.text !== undefined) element.textContent = options.text;
      if (options.type !== undefined) element.type = options.type;
      if (options.placeholder !== undefined) element.placeholder = options.placeholder;
      if (options.value !== undefined) element.value = options.value;
      if (options.attr) {
        for (const [key, value] of Object.entries(options.attr)) {
          if (value !== null) element.setAttribute(key, String(value));
        }
      }
    }
    if (typeof options === 'object' && options?.prepend) {
      this.detach(element); this.children.unshift(element); element.parentElement = this;
    } else this.append(element);
    callback?.(element);
    return element;
  }
  createDiv(options?: ElementOptions | string, callback?: (el: TestElement) => void): TestElement { return this.createEl('div', options, callback); }
  createSpan(options?: ElementOptions | string, callback?: (el: TestElement) => void): TestElement { return this.createEl('span', options, callback); }
  private detach(child: TestElement): void {
    if (!child.parentElement) return;
    if (child.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    child.parentElement.children = child.parentElement.children.filter(item => item !== child); child.parentElement = null;
  }
  append(...children: TestElement[]): void { for (const child of children) { this.detach(child); this.children.push(child); child.parentElement = this; } }
  after(child: TestElement): void {
    const parent = this.parentElement; if (!parent) return;
    this.detach(child); parent.children.splice(parent.children.indexOf(this) + 1, 0, child); child.parentElement = parent;
  }
  replaceChildren(...children: TestElement[]): void { for (const child of [...this.children]) this.detach(child); this.text = ''; this.append(...children); }
  private matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    const attribute = /^\[data-(\w+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) return attribute[2] === undefined ? attribute[1]! in this.dataset : this.dataset[attribute[1]!] === attribute[2];
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  closest(selector: string): TestElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector: string): TestElement[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string): TestElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  click(): void { if (!this.disabled && !this.hidden) this.dispatchEvent(new Event('click')); }
}
export class TestDocument {
  readonly defaultView = { setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay), clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id) };
  readonly body = new TestElement('BODY', this);
  activeElement: TestElement = this.body;
  createElement(tag: string): TestElement { return new TestElement(tag.toUpperCase(), this); }
}
