import { sameLayout, type ToolbarLayout } from '../toolbar/layout';
import type { ColorKind } from '../formatting/types';
import { BOOLEAN_KEYS, DEFAULTS, copyPreferences, type BooleanPreferenceKey, type Preferences } from './model';
import { applyColorUse, copyHistory, EMPTY_HISTORY, replayColorUses, sameHistory, type ColorHistory } from './color-history';
import { decodeSettings, encodeSettings, UnsupportedSchemaError, type DecodedSettings, type StoredSettingsV3 } from './persistence';

export type StoreStatus = 'ready' | 'loadError' | 'schemaError' | 'saveError' | 'conflict';
interface Persistence { load(): Promise<unknown>; save(value: StoredSettingsV3): Promise<void> }
export type StoreChange = { readonly kind: 'preferences'; readonly eligibilityChanged: boolean; readonly layoutChanged: boolean }
  | { readonly kind: 'history' } | { readonly kind: 'status'; readonly area: 'preferences' | 'history' };
interface Snapshot { readonly value: Preferences; readonly history: ColorHistory }
interface Reload { readonly generation: number; uses: ColorHistory; used: boolean }
const samePreferences = (a: Preferences, b: Preferences) => BOOLEAN_KEYS.every(key => a[key] === b[key]) && sameLayout(a.toolbar, b.toolbar);

export class PreferencesStore {
  private preferences = copyPreferences(DEFAULTS);
  private colors = EMPTY_HISTORY;
  get value(): Preferences { return this.preferences; }
  get history(): ColorHistory { return this.colors; }
  status: StoreStatus = 'loadError';
  historyStatus: 'ready' | 'saveError' | 'conflict' = 'ready';
  loading = false;
  reading = false;
  saving = false;
  recovered = false;
  historyRecovered = false;
  needsWriteback = false;
  loadCount = 0;
  private dirtyPreferences = false;
  private dirtyHistory = false;
  get unsavedPreferences(): boolean { return this.dirtyPreferences; }
  get unsavedHistory(): boolean { return this.dirtyHistory; }
  get historyLoading(): boolean { return this.reload !== null; }
  private revision = 0;
  private historyRevision = 0;
  private epoch = 0;
  private readGeneration = 0;
  private destroyed = false;
  private requested = false;
  private writing: { revision: number; historyRevision: number; epoch: number } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disk: Snapshot | null = null;
  private reload: Reload | null = null;
  private listeners = new Set<(change: StoreChange) => void>();

  constructor(private readonly persistence: Persistence) {}
  get enabled(): boolean { return !this.destroyed && !this.loading && (this.status === 'ready' || this.status === 'saveError'); }
  get canChangePreferences(): boolean { return this.enabled && !this.reading && this.historyStatus !== 'conflict'; }
  private get canWrite(): boolean { return this.canChangePreferences; }
  subscribe(listener: (change: StoreChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(change: StoreChange = { kind: 'status', area: 'preferences' }): void { if (!this.destroyed) for (const listener of this.listeners) listener(change); }
  private active(generation: number): boolean { return !this.destroyed && generation === this.readGeneration; }

  private replace(value: Preferences): boolean {
    const next = copyPreferences(value);
    const eligibilityChanged = BOOLEAN_KEYS.some(key => this.preferences[key] !== next[key]);
    const layoutChanged = !sameLayout(this.preferences.toolbar, next.toolbar);
    if (!eligibilityChanged && !layoutChanged) return false;
    this.preferences = next; this.revision++;
    this.emit({ kind: 'preferences', eligibilityChanged, layoutChanged });
    return true;
  }
  private replaceHistory(history: ColorHistory): boolean {
    if (sameHistory(this.colors, history)) return false;
    this.colors = copyHistory(history); this.historyRevision++; this.emit({ kind: 'history' }); return true;
  }
  private flags(parsed: DecodedSettings): void {
    this.recovered = parsed.recovered; this.historyRecovered = parsed.historyRecovered;
    this.needsWriteback = parsed.migrated || parsed.recovered || parsed.historyRecovered;
  }
  private failure(error: unknown): void { this.status = error instanceof UnsupportedSchemaError ? 'schemaError' : 'loadError'; }
  private beginRead(blocking: boolean): number {
    ++this.epoch; const generation = ++this.readGeneration;
    this.reload = null; this.reading = true; this.loading = blocking; this.emit(); return generation;
  }
  private finishRead(generation: number): void {
    if (!this.active(generation)) return;
    this.reload = null; this.reading = false; this.loading = false; this.emit();
    if (this.requested && this.canWrite) void this.save();
  }

  async load(): Promise<void> {
    if (this.destroyed) return;
    const generation = this.beginRead(true); this.requested = false;
    await this.queue;
    if (!this.active(generation)) return;
    try {
      const parsed = decodeSettings(await this.persistence.load());
      if (!this.active(generation)) return;
      this.flags(parsed); this.disk = parsed;
      this.status = 'ready'; this.historyStatus = 'ready';
      this.dirtyPreferences = false; this.dirtyHistory = false; this.loadCount++;
      this.replace(parsed.value); this.replaceHistory(parsed.history);
    } catch (error) { if (this.active(generation)) this.failure(error); }
    this.finishRead(generation);
  }

  async externalChange(): Promise<void> {
    if (this.destroyed) return;
    const generation = this.beginRead(false);
    await this.queue;
    if (!this.active(generation)) return;
    try {
      const parsed = decodeSettings(await this.persistence.load());
      if (!this.active(generation)) return;
      const preferencesChanged = !this.disk || !samePreferences(this.disk.value, parsed.value);
      const historyChanged = !this.disk || !sameHistory(this.disk.history, parsed.history);
      const dirty = this.dirtyPreferences || this.dirtyHistory;
      if (!preferencesChanged && !historyChanged) {
        // A host echo may arrive before saveData resolves. Confirm the actual
        // disk value without acknowledging newer, still-unsaved local work.
        this.dirtyPreferences = !samePreferences(this.value, parsed.value);
        this.dirtyHistory = !sameHistory(this.history, parsed.history);
        if (!this.dirtyPreferences && this.status === 'saveError') this.status = 'ready';
        if (!this.dirtyHistory && this.historyStatus === 'saveError') this.historyStatus = 'ready';
        this.flags(parsed);
      } else if (preferencesChanged && dirty) this.status = 'conflict';
      else if (historyChanged && dirty) { this.historyStatus = 'conflict'; this.emit({ kind: 'status', area: 'history' }); }
      else if (preferencesChanged || historyChanged) {
        this.flags(parsed); this.disk = parsed;
        this.status = 'ready'; this.historyStatus = 'ready';
        if (preferencesChanged) this.loadCount++;
        this.replace(parsed.value); this.replaceHistory(parsed.history);
      }
    } catch (error) { if (this.active(generation)) this.failure(error); }
    this.finishRead(generation);
  }

  async reloadHistory(): Promise<void> {
    if (!this.enabled) return;
    const generation = this.beginRead(false);
    const reload: Reload = { generation, uses: EMPTY_HISTORY, used: false };
    this.reload = reload; this.requested = false; this.emit({ kind: 'status', area: 'history' });
    await this.queue;
    if (!this.active(generation)) return;
    try {
      const parsed = decodeSettings(await this.persistence.load());
      if (!this.active(generation)) return;
      if (!this.disk || !samePreferences(this.disk.value, parsed.value)) this.status = 'conflict';
      else {
        const history = replayColorUses(parsed.history, reload.uses);
        this.flags(parsed); this.disk = parsed; this.historyStatus = 'ready';
        this.dirtyHistory = !sameHistory(history, parsed.history);
        this.replaceHistory(history);
        this.requested = reload.used && (this.dirtyHistory || this.dirtyPreferences || this.needsWriteback);
      }
    } catch (error) { if (this.active(generation)) this.failure(error); }
    this.finishRead(generation);
  }

  async set(key: BooleanPreferenceKey, value: boolean): Promise<void> {
    if (!this.canChangePreferences || !BOOLEAN_KEYS.includes(key) || typeof value !== 'boolean' || this.value[key] === value) return;
    this.dirtyPreferences = true; this.replace({ ...this.value, [key]: value }); await this.save();
  }
  async setLayout(toolbar: ToolbarLayout): Promise<void> {
    if (!this.canChangePreferences) return;
    const next = copyPreferences({ ...this.value, toolbar });
    if (samePreferences(this.value, next)) return;
    this.dirtyPreferences = true; this.replace(next); await this.save();
  }
  async resetLayout(): Promise<void> {
    if (!this.canChangePreferences) return;
    const next: Preferences = { ...this.value, toolbar: { kind: 'default' } };
    if (!samePreferences(this.value, next) || this.needsWriteback || this.dirtyPreferences || this.dirtyHistory) { this.dirtyPreferences = true; this.replace(next); await this.save(); }
  }
  async reset(): Promise<void> {
    if (!this.canChangePreferences) return;
    if (!samePreferences(this.value, DEFAULTS) || this.needsWriteback || this.dirtyPreferences || this.dirtyHistory) { this.dirtyPreferences = true; this.replace(DEFAULTS); await this.save(); }
  }
  async clearColorHistory(): Promise<void> {
    if (!this.canChangePreferences) return;
    if (!sameHistory(this.history, EMPTY_HISTORY) || this.needsWriteback || this.dirtyPreferences || this.dirtyHistory) { this.dirtyHistory = true; this.replaceHistory(EMPTY_HISTORY); await this.save(); }
  }
  recordColorUse(kind: ColorKind, color: string): void {
    if (!this.enabled) return;
    if (this.reload) { this.reload.uses = applyColorUse(this.reload.uses, kind, color); this.reload.used = true; }
    const next = applyColorUse(this.colors, kind, color);
    if (!sameHistory(this.history, next) || this.reading || this.needsWriteback) this.dirtyHistory = true;
    this.replaceHistory(next);
    if (this.dirtyHistory || this.dirtyPreferences) {
      if (this.reading && !this.reload) this.requested = true;
      void this.save();
    }
  }

  async save(): Promise<void> {
    if (!this.canWrite || (!this.dirtyPreferences && !this.dirtyHistory && !this.needsWriteback)) return;
    if (this.writing?.revision === this.revision && this.writing.historyRevision === this.historyRevision && this.writing.epoch === this.epoch) { await this.queue; return; }
    this.requested = true;
    if (!this.saving) {
      this.saving = true; this.emit();
      this.queue = Promise.resolve().then(() => this.drain()).finally(() => {
        this.saving = false; this.emit();
        this.writing = null;
        if (this.requested && this.canWrite) void this.save();
      });
    }
    await this.queue;
  }
  private async drain(): Promise<void> {
    while (this.requested && this.canWrite) {
      this.requested = false;
      const revision = this.revision, historyRevision = this.historyRevision, epoch = this.epoch;
      this.writing = { revision, historyRevision, epoch };
      const snapshot = { value: this.value, history: this.history };
      const dto = encodeSettings(snapshot.value, snapshot.history);
      try {
        await this.persistence.save(dto);
        // An in-flight write cannot be cancelled. Acknowledge its disk value for
        // external echo comparison even if a read invalidated its UI completion.
        if (!this.destroyed) this.disk = snapshot;
        if (!this.destroyed && epoch === this.epoch) {
          if (revision === this.revision) { this.dirtyPreferences = false; this.status = 'ready'; }
          if (historyRevision === this.historyRevision) { this.dirtyHistory = false; this.historyStatus = 'ready'; }
          if (!this.dirtyPreferences && !this.dirtyHistory) { this.needsWriteback = false; this.recovered = false; this.historyRecovered = false; }
        }
      } catch {
        if (!this.destroyed && epoch === this.epoch) {
          if (this.dirtyPreferences && revision === this.revision) this.status = 'saveError';
          if (this.dirtyHistory && historyRevision === this.historyRevision) { this.historyStatus = 'saveError'; this.emit({ kind: 'status', area: 'history' }); }
        }
      }
    }
  }

  destroy(): void { this.destroyed = true; ++this.epoch; ++this.readGeneration; this.reload = null; this.listeners.clear(); }
}
