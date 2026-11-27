import type { Translate } from '../i18n';
import { isEnterKey, isImeKey } from './controls';
import type { NoteNotice } from './panel-navigation';
import type { NoteChoice, NoteSearchResult, ToolbarActions } from './toolbar-types';

export interface NotePickerOptions {
  readonly initialQuery?: string;
  /** Entry reason shown above the list (for example a conflict that forced the picker open). */
  readonly notice?: NoteNotice;
}

export class NotePicker {
  readonly labelId: string;
  private abort: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private runSearch: () => Promise<void> = async () => {};
  private stopTimers: () => void = () => {};

  constructor(panel: HTMLElement, t: Translate, actions: ToolbarActions, options: NotePickerOptions = {}) {
    const input = panel.createEl('input', {
      type: 'search',
      cls: 'hover-bar-search',
      placeholder: t('searchNotes'),
      attr: { 'aria-label': t('searchNotes'), role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list' },
    });
    if (options.initialQuery) input.value = options.initialQuery;
    const list = panel.createDiv({ cls: 'hover-bar-notes', attr: { role: 'listbox' } });
    list.id = `hover-bar-notes-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('aria-controls', list.id);
    const truncated = panel.createDiv({ cls: 'hover-bar-truncated' });
    const notice = panel.createDiv({ cls: 'hover-bar-notice' });
    if (options.notice === 'conflict') notice.textContent = t('conflictNotice');
    else if (options.notice === 'stale') notice.textContent = t('candidateStale');
    panel.createDiv({ cls: 'hover-bar-hint', text: t('searchHint') });
    // Obsidian displays aria-label on hover, including labels on ancestors of a result.
    const label = panel.createSpan({ text: t('chooseNote') }); label.hidden = true;
    this.labelId = label.id = `${list.id}-label`;
    list.setAttribute('aria-labelledby', label.id);
    let choices: readonly NoteChoice[] = []; let options2: HTMLElement[] = []; let active = 0; let resultId = '';
    let composing = false; let confirming = false; let composingEnterHeld = false;
    let compositionTimer: number | ReturnType<typeof setTimeout> | undefined;
    const win = panel.ownerDocument?.defaultView;
    const clearCompositionTimer = () => {
      if (compositionTimer === undefined) return;
      if (win) win.clearTimeout(compositionTimer as number);
      else clearTimeout(compositionTimer);
      compositionTimer = undefined;
    };
    this.stopTimers = clearCompositionTimer;
    const restoreFocusFromList = () => {
      const activeElement = panel.ownerDocument?.activeElement;
      if (activeElement && list.contains(activeElement)) input.focus({ preventScroll: true });
    };
    const select = () => {
      for (const [index, option] of options2.entries()) option.setAttribute('aria-selected', String(index === active));
      const option = options2[active];
      if (option) { input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const confirm = (choice: NoteChoice) => {
      if (this.disposed) return;
      if (choice.disabledReason) actions.explain(choice.disabledReason); else actions.selectNote({ resultId, path: choice.path });
    };
    const renderState = (text: string, retryable: boolean) => {
      restoreFocusFromList();
      list.setAttribute('aria-busy', 'false'); list.textContent = text; active = 0; resultId = '';
      input.removeAttribute('aria-activedescendant'); truncated.textContent = '';
      if (retryable) {
        const retry = list.createEl('button', { type: 'button', text: t('retry') });
        retry.addEventListener('click', () => { actions.cancelNoteRequests(); void search(); });
      }
      actions.resize();
    };
    const search = async () => {
      if (this.disposed) return;
      this.abort?.abort(); this.abort = new AbortController();
      const id = ++this.generation;
      restoreFocusFromList();
      choices = []; options2 = []; resultId = ''; input.removeAttribute('aria-activedescendant');
      list.setAttribute('aria-busy', 'true'); list.textContent = t('searching'); truncated.textContent = ''; actions.resize();
      let result: NoteSearchResult;
      try {
        result = await actions.notes(input.value, this.abort.signal);
      } catch {
        if (this.disposed || id !== this.generation) return;
        renderState(t('metadataError'), true); return;
      }
      if (this.disposed || id !== this.generation || result.kind === 'cancelled') return;
      if (result.kind === 'pending') { renderState(t('metadataPending'), true); return; }
      if (result.kind === 'stale') { renderState(t('candidateStale'), true); return; }
      if (result.kind === 'error') { renderState(t('metadataError'), true); return; }
      restoreFocusFromList();
      choices = result.items; resultId = result.resultId;
      list.setAttribute('aria-busy', 'false'); list.replaceChildren(); active = 0;
      for (const [index, note] of choices.entries()) {
        const row = list.createDiv({ cls: 'hover-bar-note', attr: { role: 'option', 'aria-disabled': String(!!note.disabledReason) } });
        row.id = `${list.id}-${index}`;
        row.createEl('strong', { text: note.name });
        row.createEl('small', { text: note.path });
        if (note.matchLabel) row.createSpan({ cls: 'hover-bar-match', text: note.matchLabel });
        if (note.disabledReason) row.createSpan({ cls: 'hover-bar-note-reason', text: note.disabledReason });
        row.addEventListener('click', () => confirm(note)); options2.push(row);
      }
      if (!choices.length) list.createEl('p', { text: t('noNotes') });
      truncated.textContent = result.hasMore ? t('truncated') : '';
      select(); actions.resize();
    };
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => {
      composing = false; confirming = true;
      clearCompositionTimer();
      const release = () => { confirming = false; compositionTimer = undefined; };
      compositionTimer = win ? win.setTimeout(release, 0) : setTimeout(release, 0);
    });
    input.addEventListener('keyup', event => { if (isEnterKey(event)) { confirming = false; composingEnterHeld = false; } });
    input.addEventListener('blur', () => {
      composing = false; confirming = false; composingEnterHeld = false;
      clearCompositionTimer();
    });
    input.addEventListener('input', () => { notice.textContent = ''; void search(); });
    input.addEventListener('keydown', event => {
      // Some IMEs end composition before dispatching their confirmation keydown.
      const enter = isEnterKey(event);
      if (composing || confirming || isImeKey(event) || (enter && composingEnterHeld)) {
        if (enter) composingEnterHeld = true;
        event.stopPropagation(); return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        active = Math.max(0, Math.min(choices.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))); select();
      } else if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation(); const choice = choices[active]; if (choice) confirm(choice);
      }
    });
    this.runSearch = search;
    void search(); input.focus({ preventScroll: true }); actions.resize();
  }

  /** Re-run the current query, keeping the input value, caret and focus. */
  refresh(): void { void this.runSearch(); }

  cancel(): void { this.disposed = true; this.generation++; this.stopTimers(); this.abort?.abort(); this.abort = null; }
}
