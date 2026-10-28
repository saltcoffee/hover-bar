import type { Translate } from '../i18n';
import type { NoteChoice, ToolbarActions } from './toolbar-types';

export class NotePicker {
  private abort: AbortController | null = null;
  private generation = 0;
  private disposed = false;

  constructor(document: Document, panel: HTMLElement, t: Translate, actions: ToolbarActions) {
    const input = document.createElement('input');
    input.type = 'search'; input.placeholder = t('searchNotes'); input.setAttribute('aria-label', t('searchNotes'));
    input.className = 'hover-bar-search';
    const list = document.createElement('div'); list.className = 'hover-bar-notes';
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t('searchNotes'));
    list.id = `hover-bar-notes-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
    const hint = document.createElement('div'); hint.className = 'hover-bar-hint'; hint.textContent = t('searchHint');
    let choices: readonly NoteChoice[] = []; let options: HTMLElement[] = []; let active = 0;
    let composing = false; let composingEnterHeld = false;
    const select = () => {
      for (const [index, option] of options.entries()) option.setAttribute('aria-selected', String(index === active));
      const option = options[active];
      if (option) { input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const confirm = (choice: NoteChoice) => {
      if (this.disposed) return;
      if (choice.disabledReason) actions.explain(choice.disabledReason); else actions.selectNote(choice.path);
    };
    const search = async () => {
      if (this.disposed) return;
      this.abort?.abort(); this.abort = new AbortController();
      const id = ++this.generation;
      choices = []; options = []; input.removeAttribute('aria-activedescendant');
      list.setAttribute('aria-busy', 'true'); list.textContent = t('searching');
      try {
        const results = await actions.notes(input.value, this.abort.signal);
        if (this.disposed || id !== this.generation) return;
        choices = results;
      } catch {
        if (this.disposed || id !== this.generation) return;
        list.setAttribute('aria-busy', 'false'); list.textContent = t('searchError');
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('retry');
        retry.addEventListener('click', () => { void search(); }); list.append(retry); actions.resize(); return;
      }
      list.setAttribute('aria-busy', 'false'); list.replaceChildren(); active = 0;
      for (const [index, note] of choices.entries()) {
        const row = document.createElement('div'); row.className = 'hover-bar-note'; row.id = `${list.id}-${index}`;
        row.setAttribute('role', 'option'); row.setAttribute('aria-disabled', String(!!note.disabledReason));
        row.setAttribute('aria-label', [note.name, note.path, note.disabledReason].filter(Boolean).join(' · '));
        const name = document.createElement('strong'); name.textContent = note.name;
        const path = document.createElement('small'); path.textContent = note.path;
        row.append(name, path); row.addEventListener('click', () => confirm(note)); list.append(row); options.push(row);
      }
      if (!choices.length) { const empty = document.createElement('p'); empty.textContent = t('noNotes'); list.append(empty); }
      select(); actions.resize();
    };
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keyup', event => { if (event.key === 'Enter') composingEnterHeld = false; });
    input.addEventListener('input', () => { void search(); });
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
    panel.append(input, list, hint); void search(); input.focus({ preventScroll: true }); actions.resize();
  }

  cancel(): void { this.disposed = true; this.generation++; this.abort?.abort(); this.abort = null; }
}
