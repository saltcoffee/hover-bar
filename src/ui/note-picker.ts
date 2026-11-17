import type { Translate } from '../i18n';
import type { NoteNotice } from './panel-navigation';
import type { NoteChoice, NoteSearchResult, ToolbarActions } from './toolbar-types';

export interface NotePickerOptions {
  readonly initialQuery?: string;
  /** Entry reason shown above the list (for example a conflict that forced the picker open). */
  readonly notice?: NoteNotice;
}

export class NotePicker {
  private abort: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private runSearch: () => Promise<void> = async () => {};

  constructor(document: Document, panel: HTMLElement, t: Translate, actions: ToolbarActions, options: NotePickerOptions = {}) {
    const input = document.createElement('input');
    input.type = 'search'; input.placeholder = t('searchNotes'); input.setAttribute('aria-label', t('searchNotes'));
    input.className = 'hover-bar-search';
    if (options.initialQuery) input.value = options.initialQuery;
    const list = document.createElement('div'); list.className = 'hover-bar-notes';
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t('searchNotes'));
    list.id = `hover-bar-notes-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
    const truncated = document.createElement('div'); truncated.className = 'hover-bar-truncated';
    const notice = document.createElement('div'); notice.className = 'hover-bar-notice';
    if (options.notice === 'conflict') notice.textContent = t('conflictNotice');
    else if (options.notice === 'stale') notice.textContent = t('candidateStale');
    const hint = document.createElement('div'); hint.className = 'hover-bar-hint'; hint.textContent = t('searchHint');
    let choices: readonly NoteChoice[] = []; let options2: HTMLElement[] = []; let active = 0; let resultId = '';
    let composing = false; let composingEnterHeld = false;
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
      list.setAttribute('aria-busy', 'false'); list.textContent = text; active = 0; resultId = '';
      input.removeAttribute('aria-activedescendant'); truncated.textContent = '';
      if (retryable) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('retry');
        retry.addEventListener('click', () => { void search(); }); list.append(retry);
      }
      actions.resize();
    };
    const search = async () => {
      if (this.disposed) return;
      this.abort?.abort(); this.abort = new AbortController();
      const id = ++this.generation;
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
      choices = result.items; resultId = result.resultId;
      list.setAttribute('aria-busy', 'false'); list.replaceChildren(); active = 0;
      for (const [index, note] of choices.entries()) {
        const row = document.createElement('div'); row.className = 'hover-bar-note'; row.id = `${list.id}-${index}`;
        row.setAttribute('role', 'option'); row.setAttribute('aria-disabled', String(!!note.disabledReason));
        row.setAttribute('aria-label', [note.name, note.path, note.matchLabel, note.disabledReason].filter(Boolean).join(' · '));
        const name = document.createElement('strong'); name.textContent = note.name;
        const path = document.createElement('small'); path.textContent = note.path;
        row.append(name, path);
        if (note.matchLabel) { const match = document.createElement('span'); match.className = 'hover-bar-match'; match.textContent = note.matchLabel; row.append(match); }
        if (note.disabledReason) { const reason = document.createElement('span'); reason.className = 'hover-bar-note-reason'; reason.textContent = note.disabledReason; row.append(reason); }
        row.addEventListener('click', () => confirm(note)); list.append(row); options2.push(row);
      }
      if (!choices.length) { const empty = document.createElement('p'); empty.textContent = t('noNotes'); list.append(empty); }
      truncated.textContent = result.hasMore ? t('truncated') : '';
      select(); actions.resize();
    };
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keyup', event => { if (event.key === 'Enter') composingEnterHeld = false; });
    input.addEventListener('input', () => { notice.textContent = ''; void search(); });
    input.addEventListener('keydown', event => {
      // Some IMEs end composition before dispatching their confirmation keydown.
      if (composing || event.isComposing || event.keyCode === 229) {
        if (event.key === 'Enter') composingEnterHeld = true;
        event.stopPropagation(); return;
      }
      if (event.key === 'Enter' && composingEnterHeld) { event.stopPropagation(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        active = Math.max(0, Math.min(choices.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))); select();
      } else if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation(); const choice = choices[active]; if (choice) confirm(choice);
      }
    });
    this.runSearch = search;
    panel.append(input, list, truncated, notice, hint); void search(); input.focus({ preventScroll: true }); actions.resize();
  }

  /** Re-run the current query, keeping the input value, caret and focus. */
  refresh(): void { void this.runSearch(); }

  cancel(): void { this.disposed = true; this.generation++; this.abort?.abort(); this.abort = null; }
}
