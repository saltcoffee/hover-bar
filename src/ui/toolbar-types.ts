import type { ActionId, LayoutView } from '../toolbar/layout';

// View intent IDs evolve at the UI boundary; the editor revalidates them as domain actions.
export type FormatId = 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'foreground' | 'background' | 'clearColors';
export type ToolbarId = ActionId | 'more';
export type PaletteKind = 'foreground' | 'background';
export interface ActionView { readonly enabled: boolean; readonly pressed?: boolean; readonly mixed?: boolean; readonly reason?: string }
export interface SwatchView extends ActionView { readonly id: string; readonly color: string; readonly label: string }
export interface ToolbarViewModel {
  readonly layout: LayoutView;
  readonly controls: Readonly<Record<ToolbarId, ActionView>>;
  readonly palettes: Readonly<Record<PaletteKind, readonly SwatchView[]>>;
  readonly recent: Readonly<Record<PaletteKind, readonly SwatchView[]>>;
  readonly colors: Readonly<Record<PaletteKind, string | undefined>>;
  readonly resets: Readonly<Record<PaletteKind, ActionView>>;
}
export interface NoteChoice {
  readonly path: string;
  readonly name: string;
  /** Plain-text match explanation mapped by the controller/i18n layer. */
  readonly matchLabel?: string;
  readonly disabledReason?: string;
}
export type NoteSearchResult =
  | { readonly kind: 'ready'; readonly resultId: string; readonly items: readonly NoteChoice[]; readonly matchedCount: number; readonly hasMore: boolean }
  | { readonly kind: 'pending' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'error' }
  | { readonly kind: 'cancelled' };
/** Confirmation intent. The path and resultId are revalidated by the editor layer. */
export interface NoteSelection { readonly resultId: string; readonly path: string }
export type ActionOutcome = { readonly kind: 'applied' | 'unchanged' | 'rejected' | 'closed' };
export interface ToolbarActions {
  format(action: FormatId, color?: string): ActionOutcome;
  explain(reason: string): void;
  quickLink(): void;
  notes(query: string, signal: AbortSignal): Promise<NoteSearchResult>;
  selectNote(selection: NoteSelection): void;
  cancelNoteRequests(): void;
  close(): void;
  resize(): void;
}
