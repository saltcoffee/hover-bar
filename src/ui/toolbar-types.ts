// View intent IDs evolve at the UI boundary; the editor revalidates them as domain actions.
export type FormatId = 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'foreground' | 'background' | 'clearColors';
export type ToolbarId = FormatId | 'link' | 'chooseNote' | 'more';
export type PaletteKind = 'foreground' | 'background';
export interface ActionView { readonly enabled: boolean; readonly pressed?: boolean; readonly reason?: string }
export interface SwatchView extends ActionView { readonly id: string; readonly color: string; readonly label: string }
export interface ToolbarViewModel {
  readonly controls: Readonly<Record<ToolbarId, ActionView>>;
  readonly palettes: Readonly<Record<PaletteKind, readonly SwatchView[]>>;
  readonly resets: Readonly<Record<PaletteKind, ActionView>>;
}
export interface NoteChoice { readonly path: string; readonly name: string; readonly disabledReason?: string }
export interface ToolbarActions {
  format(action: FormatId, color?: string): void;
  explain(reason: string): void;
  quickLink(): void;
  notes(query: string, signal: AbortSignal): Promise<readonly NoteChoice[]>;
  selectNote(path: string): void;
  close(): void;
  resize(): void;
}
