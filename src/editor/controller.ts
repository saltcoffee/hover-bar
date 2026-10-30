import type { EditorView, ViewUpdate } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { editorInfoField, editorLivePreviewField, Scope, type App, type TFile } from 'obsidian';
import type { Translate } from '../i18n';
import type { EditPlan, FormatAction } from '../formatting/types';
import { PreferencesStore } from '../settings/store';
import { Toolbar, type ToolbarMeasurement } from '../ui/toolbar';
import type { ActionOutcome, NoteChoice } from '../ui/toolbar-types';
import { place, viewportBounds } from '../ui/position';
import { applyEdit, ownEdit } from './apply-edit';
import { capture, matchesSnapshot, type SelectionSnapshot } from './context';
import { actionFeedback, selectionFeedback } from './feedback';
import { formatSelection, linkSelection } from './selection-actions';
import { toolbarModel } from './toolbar-model';

export type CloseReason = 'dismiss' | 'linkApplied' | 'stale' | 'outside' | 'windowBlur' | 'modeChanged' | 'noSpace' | 'failed' | 'destroy';

function selectionKey(snapshot: SelectionSnapshot): string { return `${snapshot.path}:${snapshot.revision}:${snapshot.anchor}:${snapshot.head}`; }

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
  private readonly scope: Scope;
  private scopeActive = false;

  constructor(readonly view: EditorView, private readonly host: Host) {
    this.document = view.dom.ownerDocument;
    this.window = this.document.defaultView!;
    this.toolbar = new Toolbar(this.document, host.t, {
      explain: reason => { if (this.validate()) this.host.notify(reason); },
      format: (action, color) => this.format(action, color), quickLink: () => this.quickLink(),
      notes: (query, signal) => this.notes(query, signal), selectNote: path => this.selectNote(path),
      close: () => this.close('dismiss'), resize: () => this.measure(),
    });
    this.scope = new Scope(host.app.scope);
    this.scope.register([], 'Escape', event => {
      if (!this.toolbar.visible || !this.toolbar.ownsFocus() || event.isComposing || event.keyCode === 229) return;
      // Host hotkeys run before DOM bubbling. Consume Escape here so the host
      // cannot move focus back to the editor before the panel restores its row.
      this.toolbar.escape(); event.stopPropagation(); return false;
    });
    this.listen(this.toolbar.root, 'focusin', () => {
      if (!this.scopeActive) { this.scopeActive = true; this.host.app.keymap.pushScope(this.scope); }
    });
    this.observer = new ResizeObserver(() => this.measure());
    this.listen(this.toolbar.root, 'keydown', event => {
      const key = event as KeyboardEvent;
      if ((key.target as HTMLElement).tagName === 'INPUT' || !(key.metaKey || key.ctrlKey) || key.altKey) return;
      const lower = key.key.toLowerCase();
      if (lower !== 'z' && !(lower === 'y' && key.ctrlKey)) return;
      if (!this.validate()) return;
      key.preventDefault(); key.stopPropagation();
      this.close('dismiss');
      if (key.shiftKey || lower === 'y') redo(this.view); else undo(this.view);
      if (!this.view.hasFocus) this.view.focus();
    });
    this.listen(view.dom, 'pointerdown', event => this.beginDrag(event as PointerEvent));
    this.listen(view.dom, 'compositionstart', () => this.close('stale'));
    const checkFocus = (event: Event) => {
      const next = (event as FocusEvent).relatedTarget;
      // Native Tab can run microtasks between focusout and focusin, while activeElement is body.
      if (next && next instanceof this.document.defaultView!.Node) {
        if (this.toolbar.root.contains(next)) return;
        if (this.view.dom.contains(next)) { this.releaseScope(); return; }
      }
      queueMicrotask(() => {
        if (!this.toolbar.ownsFocus()) this.releaseScope();
        if (!this.destroyed && !this.view.hasFocus && !this.toolbar.ownsFocus()) this.close('stale');
      });
    };
    this.listen(view.dom, 'focusout', checkFocus);
    this.listen(this.toolbar.root, 'focusout', checkFocus);
    this.listen(this.document, 'pointerdown', event => { if (!this.toolbar.contains(event)) this.close('outside'); }, true);
    this.listen(this.document, 'contextmenu', event => {
      if (!this.toolbar.contains(event)) this.close('outside');
    });
    this.listen(this.document, 'keydown', event => {
      if ((event as KeyboardEvent).key === 'Escape' && !this.toolbar.ownsFocus()) this.close('stale');
    });
    this.listen(this.window, 'blur', () => { this.stopDrag(); this.close('windowBlur'); });
    this.listen(this.window, 'resize', () => this.measure());
    if (this.window.visualViewport) {
      this.listen(this.window.visualViewport, 'resize', () => this.measure());
      this.listen(this.window.visualViewport, 'scroll', () => this.measure());
    }
    this.listen(this.document, 'scroll', () => this.measure(), true);
    host.controllers.add(this);
  }

  private listen(target: EventTarget, type: string, handler: EventListener, capture = false): void {
    target.addEventListener(type, handler, capture);
    this.disposers.push(() => target.removeEventListener(type, handler, capture));
  }

  private beginDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
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
      this.close('modeChanged'); return;
    }
    const own = update.transactions.some(transaction => transaction.annotation(ownEdit));
    if (update.docChanged && !own) { this.close('stale'); return; }
    if (update.selectionSet && !own && !update.startState.selection.eq(update.state.selection)) {
      this.close('stale');
      this.dismissed = '';
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
    const result = capture(this.view, this.host.app, this.host.store);
    if (result.kind === 'blocked') {
      this.close('stale'); if (manual) this.host.notify(this.host.t(selectionFeedback(result.reason))); return false;
    }
    const snapshot = result.snapshot;
    const key = selectionKey(snapshot);
    if (!manual && key === this.dismissed) return false;
    for (const controller of this.host.controllers) {
      if (controller !== this && controller.document === this.document) controller.close('outside');
    }
    const continuing = this.current?.file === snapshot.file && selectionKey(this.current) === key;
    this.focusRequested = manual || (continuing && this.focusRequested);
    this.current = snapshot;
    this.toolbar.update(toolbarModel(snapshot, this.host.store.value, this.host.t));
    this.toolbar.show();
    this.observer.observe(this.toolbar.root);
    this.measure();
    return true;
  }

  close(reason: CloseReason): void {
    const snapshot = this.current;
    if (snapshot && reason === 'dismiss') this.dismissed = selectionKey(snapshot);
    const returnFocus = (reason === 'dismiss' || reason === 'linkApplied') && this.toolbar.ownsFocus();
    this.current = null; this.focusRequested = false; this.noteTargets.clear(); this.releaseScope();
    if (this.frame) this.window.cancelAnimationFrame(this.frame);
    this.frame = 0; this.observer.disconnect(); this.toolbar.hide();
    const file = this.view.state.field(editorInfoField, false)?.file;
    if (returnFocus && snapshot && !this.destroyed && this.view.dom.isConnected && this.view.dom.ownerDocument === this.document &&
      file === snapshot.file && file.path === snapshot.path && !this.view.hasFocus) this.view.focus();
  }

  private releaseScope(): void {
    if (this.scopeActive) { this.scopeActive = false; this.host.app.keymap.popScope(this.scope); }
  }

  private validate(): SelectionSnapshot | null {
    if (this.destroyed || !this.current) return null;
    if (!matchesSnapshot(this.view, this.current)) {
      this.close('stale'); this.host.notify(this.host.t('stale')); return null;
    }
    const result = capture(this.view, this.host.app, this.host.store);
    if (result.kind === 'blocked') {
      this.close('stale'); this.host.notify(this.host.t(selectionFeedback(result.reason))); return null;
    }
    return result.snapshot;
  }

  private format(action: FormatAction, color?: string): ActionOutcome {
    const snapshot = this.validate();
    if (!snapshot) return { kind: 'closed' };
    const result = formatSelection(snapshot, action, color);
    if (result.kind === 'unavailable') { this.host.notify(this.host.t(actionFeedback(result.reason))); return { kind: 'rejected' }; }
    if (result.kind === 'noop') return { kind: 'unchanged' };
    return this.commit(snapshot, result.plan, false);
  }

  private commit(snapshot: SelectionSnapshot, plan: EditPlan, link: boolean): ActionOutcome {
    if (this.applying) return { kind: 'rejected' };
    this.applying = true;
    try {
      if (!applyEdit(this.view, snapshot, plan)) {
        this.close('failed'); this.host.notify(this.host.t('failed')); return { kind: 'closed' };
      }
      if (link) this.close('linkApplied');
      else {
        const result = capture(this.view, this.host.app, this.host.store);
        if (result.kind === 'ready') { this.current = result.snapshot; this.toolbar.update(toolbarModel(result.snapshot, this.host.store.value, this.host.t)); this.measure(); }
        else this.close('stale');
      }
      return { kind: this.current ? 'applied' : 'closed' };
    } finally { this.applying = false; }
  }

  private quickLink(): void {
    const snapshot = this.validate();
    if (!snapshot) return;
    const text = snapshot.located.fragment.text;
    const result = linkSelection(snapshot, text);
    if (result.kind === 'unavailable') { this.host.notify(this.host.t(actionFeedback(result.reason))); return; }
    const matches = this.host.app.vault.getMarkdownFiles().filter(file => file.basename === text);
    if (matches.length > 1) { this.toolbar.notePicker(); return; }
    if (matches[0]) this.selectNote(matches[0].path, matches[0]);
    else {
      if (this.host.app.metadataCache.getFirstLinkpathDest(text, snapshot.path)) {
        this.toolbar.notePicker(); return;
      }
      this.commit(snapshot, result.plan, true);
    }
  }

  private selectNote(path: string, expected = this.noteTargets.get(path)): void {
    const snapshot = this.validate();
    if (!snapshot) return;
    const file = this.host.app.vault.getFileByPath(path);
    if (!file || file !== expected || file.extension !== 'md') { this.close('stale'); this.host.notify(this.host.t('stale')); return; }
    const target = this.host.app.metadataCache.fileToLinktext(file, snapshot.path, true);
    const result = linkSelection(snapshot, target);
    if (result.kind === 'unavailable') { this.host.notify(this.host.t(actionFeedback(result.reason))); return; }
    if (this.host.app.metadataCache.getFirstLinkpathDest(target, snapshot.path) !== file) {
      this.host.notify(this.host.t('invalidLink')); return;
    }
    this.commit(snapshot, result.plan, true);
  }

  private async notes(query: string, signal: AbortSignal): Promise<readonly NoteChoice[]> {
    const session = this.current;
    if (!session) return [];
    const text = query.trim().toLocaleLowerCase();
    const results: NoteChoice[] = [];
    const targets = new Map<string, TFile>();
    const files = this.host.app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted || this.current !== session || this.destroyed) return [];
      const file = files[i]!;
      if (file.path.toLocaleLowerCase().includes(text)) {
        targets.set(file.path, file);
        const target = this.host.app.metadataCache.fileToLinktext(file, session.path, true);
        const result = linkSelection(session, target);
        results.push({ path: file.path, name: file.basename, disabledReason: result.kind === 'unavailable' ? this.host.t(actionFeedback(result.reason)) : undefined });
      }
      if (results.length === 50) break;
      if (i > 0 && i % 500 === 0) await new Promise<void>(resolve => this.window.setTimeout(resolve, 0));
    }
    if (signal.aborted || this.current !== session || this.destroyed) return [];
    this.noteTargets = targets;
    return results;
  }

  private measure(): void {
    if (!this.current || this.destroyed) return;
    const session = this.current;
    let measurement: ToolbarMeasurement | null = null;
    this.view.requestMeasure({ key: this,
      read: () => {
        if (this.current !== session || !this.toolbar.visible) return null;
        const from = this.view.coordsAtPos(Math.min(this.current.anchor, this.current.head), 1);
        const to = this.view.coordsAtPos(Math.max(this.current.anchor, this.current.head), -1);
        const pane = this.view.scrollDOM.getBoundingClientRect();
        const size = this.toolbar.root.getBoundingClientRect();
        if (!from || !to) return null;
        const screen = viewportBounds(this.window.innerWidth, this.window.innerHeight, this.window.visualViewport);
        const bounds = { left: Math.max(screen.left, pane.left), right: Math.min(screen.right, pane.right), top: Math.max(screen.top, pane.top), bottom: Math.min(screen.bottom, pane.bottom) };
        const head = this.current.anchor > this.current.head ? from : to;
        const headVisible = head.top >= bounds.top && head.bottom <= bounds.bottom;
        const anchor = { left: head.left, right: head.right, top: Math.max(bounds.top, Math.min(from.top, to.top)), bottom: Math.min(bounds.bottom, Math.max(from.bottom, to.bottom)) };
        if (!headVisible) return null;
        const availableHeight = Math.max(anchor.top - bounds.top - 8, bounds.bottom - anchor.bottom - 8);
        measurement = this.toolbar.readLayout(bounds, availableHeight);
        return measurement.fits ? place(anchor, bounds, size.width, size.height) : null;
      },
      write: position => {
        if (this.destroyed || this.current !== session) return;
        if (measurement?.fits && this.toolbar.applyLayout(measurement)) { this.measure(); return; }
        const focus = this.focusRequested;
        this.focusRequested = false;
        if (!position) { const notify = focus || this.toolbar.takeSpaceFeedback(); this.close('noSpace'); if (notify) this.host.notify(this.host.t('noSpace')); }
        else { this.toolbar.positioned(position.left, position.top); if (focus) this.toolbar.focus(); }
      },
    });
  }

  matchesEditor(editor: unknown): boolean { return this.view.state.field(editorInfoField, false)?.editor === editor; }
  reconcile(): void {
    if (!this.current || this.destroyed) return;
    const result = capture(this.view, this.host.app, this.host.store);
    if (result.kind === 'blocked' || !matchesSnapshot(this.view, this.current)) this.close('stale');
    else this.measure();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.stopDrag(); this.close('destroy'); this.toolbar.destroy();
    for (const dispose of this.disposers) dispose();
    this.host.controllers.delete(this);
  }
}
