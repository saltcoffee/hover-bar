export const MAX_SOURCE = 10_000;
export const MAX_LINES = 100;
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

/** One non-empty logical line selected in a continuous multi-line selection. */
export interface LineSegment {
  readonly lineFrom: number;
  readonly base: number;
  readonly source: string;
  readonly lineLength: number;
  readonly located: LocatedFragment;
}

/** One formatting change relative to its line segment (see LineSegment.base). */
export interface EditChange {
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly expected: string;
  readonly insert: string;
  readonly contentFrom: number;
  readonly contentTo: number;
}

/** Selection to restore after the edit, in document order (anchor <= head). */
export interface PlanSelection { readonly anchor: number; readonly head: number }

/** Ordered, non-overlapping multi-change plan plus its selection mapping. */
export interface EditPlan {
  readonly changes: readonly EditChange[];
  readonly selection: PlanSelection;
}
export type FormatUnavailableReason = 'codeOnly' | 'plainOnly' | 'tooLong' | 'invalidParameter' | 'multiLineDisabled';
export type FormatResult = { kind: 'edit'; plan: EditPlan } | { kind: 'noop' } | { kind: 'unavailable'; reason: FormatUnavailableReason };
