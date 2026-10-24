import type { EditorView, ViewUpdate } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { editorInfoField, editorLivePreviewField, type App, type TFile } from 'obsidian';
import type { Translate } from '../i18n';
import { formatFragment } from '../formatting/markdown';
import type { EditPlan, FormatAction } from '../formatting/types';
import { linkPlan, safeLinkText } from '../links/wikilink';
import { PreferencesStore } from '../settings/store';
import { Toolbar, type NoteChoice } from '../ui/toolbar';
import { place } from '../ui/position';
import { applyEdit, ownEdit } from './apply-edit';
import { capture, sameSelection, type SelectionSnapshot } from './context';

export interface Host {
  app: App; store: PreferencesStore; t: Translate;
  controllers: Set<EditorController>;
  notify(message: string): void;
}

export class EditorController {
  private readonly toolbar: Toolbar;
  private current: SelectionSnapshot | null = null;
  private destroyed = false;
  private dragging = false;
  private applying = false;
  private focusRequested = false;
  private frame = 0;
  private dismissed = '';
  private observer: ResizeObserver;
  private readonly document: Document;
  private readonly window: Window;
  private readonly disposers: (() => void)[] = [];
  private noteTargets = new Map<string, TFile>();

  constructor(readonly view: EditorView, private readonly host: Host) {
    this.document = view.dom.ownerDocument;
    this.window = this.document.defaultView!;
    this.toolbar = new Toolbar(this.document, host.t, {
      available: (action, color) => !!this.current && formatFragment(this.current.located, this.current.source, action, color).kind !== 'unavailable',
      format: (action, color) => this.format(action, color), quickLink: () => this.quickLink(),
      notes: (query, signal) => this.notes(query, signal), selectNote: path => this.selectNote(path),
      close: () => this.close(true), resize: () => this.measure(),
    });
    this.observer = new ResizeObserver(() => this.measure());
    this.listen(this.toolbar.root, 'keydown', event => {
      const key = event as KeyboardEvent;
      if ((key.target as HTMLElement).tagName === 'INPUT' || !(key.metaKey || key.ctrlKey) || key.altKey) return;
      const lower = key.key.toLowerCase();
      if (lower !== 'z' && !(lower === 'y' && key.ctrlKey)) return;
      if (!this.validate()) return;
      key.preventDefault(); key.stopPropagation();
      this.close(true);
      if (key.shiftKey || lower === 'y') redo(this.view); else undo(this.view);
      this.view.focus();
    });
    this.listen(view.dom, 'pointerdown', event => this.beginDrag(event as PointerEvent));
    this.listen(view.dom, 'compositionstart', () => this.close(false));
    const checkFocus = () => queueMicrotask(() => {
      if (!this.destroyed && !this.view.hasFocus && !this.toolbar.ownsFocus()) this.close(false);
    });
    this.listen(view.dom, 'focusout', checkFocus);
    this.listen(this.toolbar.root, 'focusout', checkFocus);
    this.listen(this.document, 'pointerdown', event => { if (!this.toolbar.contains(event)) this.close(false); }, true);
    this.listen(this.document, 'contextmenu', () => this.close(false));
    this.listen(this.document, 'keydown', event => {
      if ((event as KeyboardEvent).key === 'Escape' && !this.toolbar.ownsFocus()) this.close(false);
    });
    this.listen(this.window, 'blur', () => { this.stopDrag(); this.close(false); });
    this.listen(this.window, 'resize', () => this.measure());
    this.listen(this.document, 'scroll', () => this.measure(), true);
    host.controllers.add(this);
  }

  private listen(target: EventTarget, type: string, handler: EventListener, capture = false): void {
    target.addEventListener(type, handler, capture);
    this.disposers.push(() => target.removeEventListener(type, handler, capture));
  }

  private beginDrag(event: PointerEvent): void {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    this.dragging = true; this.dismissed = '';
    this.window.addEventListener('pointerup', this.endDrag, true);
    this.window.addEventListener('pointercancel', this.endDrag, true);
  }
  private endDrag = (event: Event): void => {
    const wasDragging = this.dragging;
    this.stopDrag();
    if (wasDragging && event.type === 'pointerup' && this.host.store.value.automatic) this.schedule();
  };
  private stopDrag(): void {
    this.dragging = false;
    this.window.removeEventListener('pointerup', this.endDrag, true);
    this.window.removeEventListener('pointercancel', this.endDrag, true);
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return;
    if (update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false)) {
      this.close(false); return;
    }
    const own = update.transactions.some(transaction => transaction.annotation(ownEdit));
    if (update.docChanged && !own) { this.close(false); return; }
    if (update.selectionSet && !own && !update.startState.selection.eq(update.state.selection)) {
      this.close(false);
      const pointer = update.transactions.some(transaction => transaction.isUserEvent('select.pointer'));
      const keyboard = this.host.store.value.keyboard && update.transactions.some(transaction => transaction.isUserEvent('select'));
      if (this.host.store.value.automatic && !this.dragging && (pointer || keyboard)) this.schedule();
    } else if (this.current && (update.geometryChanged || update.viewportChanged)) this.measure();
  }

  private schedule(): void {
    if (this.frame) this.window.cancelAnimationFrame(this.frame);
    this.frame = this.window.requestAnimationFrame(() => { this.frame = 0; this.show(false); });
  }

  show(manual: boolean): boolean {
    if (this.destroyed || (!manual && !this.view.hasFocus)) return false;
    const snapshot = capture(this.view, this.host.app, this.host.store);
    if (!snapshot) { if (manual) this.host.notify(this.host.t('unsupported')); return false; }
    const key = `${snapshot.revision}:${snapshot.anchor}:${snapshot.head}`;
    if (!manual && key === this.dismissed) return false;
    for (const controller of this.host.controllers) {
      if (controller !== this && controller.document === this.document) controller.close(false);
    }
    this.current = snapshot;
    this.focusRequested ||= manual;
    this.toolbar.update(snapshot.located.fragment);
    this.toolbar.show(this.view.scrollDOM.clientWidth < 384);
    this.observer.observe(this.toolbar.root);
    this.measure();
    return true;
  }

  close(restoreFocus: boolean): void {
    if (this.current) this.dismissed = `${this.current.revision}:${this.current.anchor}:${this.current.head}`;
    const hadFocus = this.toolbar.ownsFocus();
    this.current = null;
    this.focusRequested = false;
    this.noteTargets.clear();
    if (this.frame) this.window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observer.disconnect(); this.toolbar.hide();
    if (restoreFocus && hadFocus && this.view.dom.isConnected && !this.destroyed) this.view.focus();
  }

  private validate(): SelectionSnapshot | null {
    if (this.destroyed || !this.current) return null;
    const fresh = capture(this.view, this.host.app, this.host.store);
    if (!fresh || !sameSelection(this.current, fresh)) {
      this.close(false); this.host.notify(this.host.t('stale')); return null;
    }
    return fresh;
  }

  private format(action: FormatAction, color?: string): void {
    const snapshot = this.validate();
    if (!snapshot) return;
    const result = formatFragment(snapshot.located, snapshot.source, action, color);
    if (result.kind === 'unavailable') this.host.notify(this.host.t('unsupported'));
    else if (result.kind === 'edit') this.commit(snapshot, result.plan, false);
  }

  private commit(snapshot: SelectionSnapshot, plan: EditPlan, link: boolean): void {
    if (this.applying) return;
    this.applying = true;
    try {
      if (!applyEdit(this.view, snapshot, plan)) {
        this.close(false); this.host.notify(this.host.t('failed')); return;
      }
      if (link) this.close(true);
      else {
        this.current = capture(this.view, this.host.app, this.host.store);
        if (this.current) { this.toolbar.update(this.current.located.fragment); this.measure(); }
        else this.close(false);
      }
    } finally { this.applying = false; }
  }

  private quickLink(): void {
    const snapshot = this.validate();
    if (!snapshot) return;
    const text = snapshot.located.fragment.text;
    if (!safeLinkText(text)) { this.host.notify(this.host.t('invalidLink')); return; }
    const matches = this.host.app.vault.getMarkdownFiles().filter(file => file.basename === text);
    if (matches.length > 1) { this.toolbar.notePicker(); return; }
    if (matches[0]) this.selectNote(matches[0].path, matches[0]);
    else {
      if (this.host.app.metadataCache.getFirstLinkpathDest(text, snapshot.path)) {
        this.toolbar.notePicker(); return;
      }
      const plan = linkPlan(snapshot.located, snapshot.source, text);
      if (plan) this.commit(snapshot, plan, true); else this.host.notify(this.host.t('invalidLink'));
    }
  }

  private selectNote(path: string, expected = this.noteTargets.get(path)): void {
    const snapshot = this.validate();
    if (!snapshot) return;
    const file = this.host.app.vault.getFileByPath(path);
    if (!file || file !== expected || file.extension !== 'md') { this.close(false); this.host.notify(this.host.t('stale')); return; }
    const target = this.host.app.metadataCache.fileToLinktext(file, snapshot.path, true);
    const plan = linkPlan(snapshot.located, snapshot.source, target);
    if (!plan || this.host.app.metadataCache.getFirstLinkpathDest(target, snapshot.path) !== file) {
      this.host.notify(this.host.t('invalidLink')); return;
    }
    this.commit(snapshot, plan, true);
  }

  private async notes(query: string, signal: AbortSignal): Promise<readonly NoteChoice[]> {
    const session = this.current;
    const text = query.trim().toLocaleLowerCase();
    const results: NoteChoice[] = [];
    this.noteTargets.clear();
    const files = this.host.app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted || this.current !== session || this.destroyed) return [];
      const file = files[i]!;
      if (file.path.toLocaleLowerCase().includes(text)) {
        this.noteTargets.set(file.path, file);
        const target = this.host.app.metadataCache.fileToLinktext(file, session?.path ?? '', true);
        results.push({ path: file.path, name: file.basename, disabled: !safeLinkText(target) });
      }
      if (results.length === 50) break;
      if (i > 0 && i % 500 === 0) await new Promise<void>(resolve => this.window.setTimeout(resolve, 0));
    }
    return results;
  }

  private measure(): void {
    if (!this.current || this.destroyed) return;
    this.view.requestMeasure({ key: this,
      read: () => {
        if (!this.current || !this.toolbar.visible) return null;
        const from = this.view.coordsAtPos(Math.min(this.current.anchor, this.current.head), 1);
        const to = this.view.coordsAtPos(Math.max(this.current.anchor, this.current.head), -1);
        const pane = this.view.scrollDOM.getBoundingClientRect();
        const size = this.toolbar.root.getBoundingClientRect();
        if (!from || !to) return null;
        const bounds = { left: Math.max(0, pane.left), right: Math.min(this.window.innerWidth, pane.right), top: Math.max(0, pane.top), bottom: Math.min(this.window.innerHeight, pane.bottom) };
        const head = this.current.anchor > this.current.head ? from : to;
        if (head.top < bounds.top || head.bottom > bounds.bottom) return null;
        const anchor = { left: head.left, right: head.right, top: Math.max(bounds.top, Math.min(from.top, to.top)), bottom: Math.min(bounds.bottom, Math.max(from.bottom, to.bottom)) };
        return place(anchor, bounds, size.width, size.height);
      },
      write: position => {
        if (this.destroyed || !this.current) return;
        const focus = this.focusRequested;
        this.focusRequested = false;
        if (!position) { this.close(false); if (focus) this.host.notify(this.host.t('noSpace')); }
        else { this.toolbar.positioned(position.left, position.top); if (focus) this.toolbar.focus(); }
      },
    });
  }

  matchesEditor(editor: unknown): boolean { return this.view.state.field(editorInfoField, false)?.editor === editor; }
  reconcile(): void {
    if (!this.current || this.destroyed) return;
    const snapshot = capture(this.view, this.host.app, this.host.store);
    if (!snapshot || !sameSelection(this.current, snapshot)) this.close(false);
    else this.measure();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.stopDrag(); this.close(false); this.toolbar.destroy();
    for (const dispose of this.disposers) dispose();
    this.host.controllers.delete(this);
  }
}
