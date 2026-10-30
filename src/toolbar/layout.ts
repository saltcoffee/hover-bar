export const ACTION_IDS = ['bold', 'italic', 'strike', 'code', 'highlight', 'foreground', 'background', 'link', 'chooseNote', 'clearColors'] as const;
export type ActionId = typeof ACTION_IDS[number];
export const BASIC_FORMAT_IDS = ['bold', 'italic', 'strike', 'code', 'highlight'] as const;
export const DEFAULT_PINNED: readonly ActionId[] = ACTION_IDS.slice(0, 9);
const DEFAULT_PRIORITY: readonly ActionId[] = ['strike', 'bold', 'foreground', 'background', 'link', 'chooseNote', 'italic', 'code', 'highlight'];

export type ToolbarLayout =
  | { readonly kind: 'default' }
  | { readonly kind: 'custom'; readonly pinned: readonly ActionId[] };
export interface LayoutView {
  readonly pinned: readonly ActionId[];
  readonly priority: readonly ActionId[];
  readonly unpinned: readonly ActionId[];
  readonly grouped: boolean;
}
export interface LayoutMetrics {
  readonly widths: Readonly<Record<ActionId | 'more', number>>;
  readonly shell: number;
  readonly gap: number;
  readonly groupGap: number;
}
export interface LayoutResult {
  readonly bar: readonly ActionId[];
  readonly overflow: readonly ActionId[];
  readonly width: number;
  readonly fits: boolean;
}

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && (ACTION_IDS as readonly string[]).includes(value);
}

export function copyLayout(value: ToolbarLayout): ToolbarLayout {
  if (value.kind === 'default') return Object.freeze({ kind: 'default' });
  if (value.kind !== 'custom' || !Array.isArray(value.pinned) ||
      value.pinned.some(id => !isActionId(id)) || new Set(value.pinned).size !== value.pinned.length) throw new Error('Invalid toolbar layout');
  return Object.freeze({ kind: 'custom', pinned: Object.freeze([...value.pinned]) });
}

export function sameLayout(first: ToolbarLayout, second: ToolbarLayout): boolean {
  return first.kind === second.kind && (first.kind === 'default' ||
    (second.kind === 'custom' && first.pinned.length === second.pinned.length && first.pinned.every((id, index) => id === second.pinned[index])));
}

export function resolveLayout(layout: ToolbarLayout, active: readonly ActionId[] = []): LayoutView {
  const checked = copyLayout(layout);
  const pinned = [...(checked.kind === 'default' ? DEFAULT_PINNED : checked.pinned)];
  const promoted: readonly ActionId[] = BASIC_FORMAT_IDS.filter(id => id !== 'strike' && active.includes(id));
  const priority: ActionId[] = checked.kind === 'default'
    ? ['strike', ...promoted, ...DEFAULT_PRIORITY.filter(id => id !== 'strike' && !promoted.includes(id))]
    : [...pinned];
  return { pinned, priority, unpinned: ACTION_IDS.filter(id => !pinned.includes(id)), grouped: checked.kind === 'default' };
}

export function layoutWidth(ids: readonly ActionId[], grouped: boolean, metrics: LayoutMetrics): number {
  const items: readonly (ActionId | 'more')[] = [...ids, 'more'];
  return metrics.shell + (items.length - 1) * metrics.gap + items.reduce((width, id, index) =>
    width + metrics.widths[id] + (grouped && index > 0 && (id === 'foreground' || id === 'link') ? metrics.groupGap : 0), 0);
}

export function fitLayout(view: LayoutView, metrics: LayoutMetrics, budget: number): LayoutResult {
  if (new Set(view.pinned).size !== view.pinned.length || view.pinned.some(id => !isActionId(id)) ||
      view.priority.length !== view.pinned.length || new Set(view.priority).size !== view.priority.length ||
      view.priority.some(id => !view.pinned.includes(id)) ||
      ACTION_IDS.some(id => view.unpinned.includes(id) === view.pinned.includes(id)) ||
      view.unpinned.length + view.pinned.length !== ACTION_IDS.length) throw new Error('Invalid layout input');
  if (![metrics.shell, metrics.gap, metrics.groupGap, ...Object.values(metrics.widths)].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid layout metrics');
  let bar = [...view.pinned];
  for (const id of [...view.priority].reverse()) {
    if (layoutWidth(bar, view.grouped, metrics) <= budget) break;
    bar = bar.filter(candidate => candidate !== id);
  }
  const width = layoutWidth(bar, view.grouped, metrics);
  return { bar, overflow: [...view.pinned.filter(id => !bar.includes(id)), ...view.unpinned], width, fits: width <= budget };
}

export function paletteColumns(width: number, minimum = 32, gap = 8): number {
  return Math.max(0, Math.min(4, Math.floor((width + gap) / (Math.max(32, minimum) + gap))));
}
