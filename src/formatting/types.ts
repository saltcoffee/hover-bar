export const MAX_SOURCE = 10_000;
export type Mark = 'bold' | 'italic' | 'strike' | 'highlight';
export type ColorKind = 'foreground' | 'background';
export type FormatAction = Mark | 'code' | 'clearColors' | ColorKind;
export interface Fragment {
  readonly text: string;
  readonly plainSource?: string;
  readonly marks: readonly Mark[];
  readonly foreground?: string;
  readonly background?: string;
  readonly code: boolean;
  readonly leading: string;
  readonly trailing: string;
  readonly contentFrom: number;
  readonly contentTo: number;
}
export interface LocatedFragment { readonly from: number; readonly to: number; readonly fragment: Fragment }
export interface EditPlan {
  readonly from: number; readonly to: number; readonly expected: string; readonly insert: string;
  readonly contentFrom: number; readonly contentTo: number;
}
export type FormatResult = { kind: 'edit'; plan: EditPlan } | { kind: 'noop' } | { kind: 'unavailable' };
