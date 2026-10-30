import { sameLayout, type ToolbarLayout } from '../toolbar/layout';
import { BOOLEAN_KEYS, DEFAULTS, copyPreferences, type BooleanPreferenceKey, type Preferences } from './model';
import { decodeSettings, encodeSettings, UnsupportedSchemaError, type StoredSettingsV2 } from './persistence';

export type StoreStatus = 'ready' | 'loadError' | 'schemaError' | 'saveError' | 'conflict';
interface Persistence { load(): Promise<unknown>; save(value: StoredSettingsV2): Promise<void> }
export type StoreChange = { readonly kind: 'preferences'; readonly eligibilityChanged: boolean; readonly layoutChanged: boolean } | { readonly kind: 'status' };
interface SaveRequest { readonly revision: number; readonly epoch: number; readonly dto: StoredSettingsV2; readonly promise: Promise<void> }

export class PreferencesStore {
  private preferences: Preferences = copyPreferences(DEFAULTS);
  get value(): Preferences { return this.preferences; }
  status: StoreStatus = 'loadError';
  loading = false;
  saving = false;
  recovered = false;
  needsWriteback = false;
  loadCount = 0;
  private dirty = false;
  private revision = 0;
  private epoch = 0;
  private readGeneration = 0;
  private destroyed = false;
  private queue: Promise<void> = Promise.resolve();
  private requests = new Set<SaveRequest>();
  private listeners = new Set<(change: StoreChange) => void>();

  constructor(private readonly persistence: Persistence) {}
  get enabled(): boolean { return !this.destroyed && !this.loading && (this.status === 'ready' || this.status === 'saveError'); }
  subscribe(listener: (change: StoreChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(change: StoreChange = { kind: 'status' }): void { if (!this.destroyed) for (const listener of this.listeners) listener(change); }

  private replace(value: Preferences): boolean {
    const next = copyPreferences(value);
    const eligibilityChanged = BOOLEAN_KEYS.some(key => this.preferences[key] !== next[key]);
    const layoutChanged = !sameLayout(this.preferences.toolbar, next.toolbar);
    if (!eligibilityChanged && !layoutChanged) return false;
    this.preferences = next; this.revision++;
    this.emit({ kind: 'preferences', eligibilityChanged, layoutChanged });
    return true;
  }

  async load(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.readGeneration;
    const epoch = ++this.epoch;
    this.loading = true; this.emit();
    await this.queue;
    if (this.destroyed || generation !== this.readGeneration || epoch !== this.epoch) return;
    try {
      const parsed = decodeSettings(await this.persistence.load());
      if (this.destroyed || generation !== this.readGeneration || epoch !== this.epoch) return;
      this.recovered = parsed.recovered; this.needsWriteback = parsed.migrated || parsed.recovered;
      this.status = 'ready'; this.dirty = false; this.loadCount++;
      this.replace(parsed.value);
    } catch (error) {
      if (this.destroyed || generation !== this.readGeneration || epoch !== this.epoch) return;
      this.status = error instanceof UnsupportedSchemaError ? 'schemaError' : 'loadError';
    }
    this.loading = false;
    this.emit();
  }

  async externalChange(): Promise<void> {
    if (this.destroyed) return;
    if (this.dirty || this.requests.size > 0) {
      ++this.epoch; ++this.readGeneration; this.loading = false; this.status = 'conflict'; this.emit();
    }
    else await this.load();
  }

  async set(key: BooleanPreferenceKey, value: boolean): Promise<void> {
    if (!this.enabled || !BOOLEAN_KEYS.includes(key) || typeof value !== 'boolean' || this.value[key] === value) return;
    this.replace({ ...this.value, [key]: value });
    await this.save();
  }

  async setLayout(toolbar: ToolbarLayout): Promise<void> {
    if (!this.enabled || !this.replace({ ...this.value, toolbar })) return;
    await this.save();
  }

  async resetLayout(): Promise<void> {
    if (!this.enabled) return;
    const changed = this.replace({ ...this.value, toolbar: { kind: 'default' } });
    if (changed || this.needsWriteback || this.dirty) await this.save();
  }

  async reset(): Promise<void> {
    if (!this.enabled) return;
    const changed = this.replace(DEFAULTS);
    if (changed || this.needsWriteback || this.dirty) await this.save();
  }

  async save(): Promise<void> {
    if (!this.enabled) return;
    const dto = encodeSettings(this.value), revision = this.revision, epoch = this.epoch;
    const duplicate = [...this.requests].find(request => request.revision === revision && request.epoch === epoch);
    if (duplicate) return duplicate.promise;
    this.dirty = true; this.saving = true;
    const promise = this.queue.then(async () => {
      if (this.destroyed || epoch !== this.epoch) return;
      try {
        await this.persistence.save(dto);
        if (!this.destroyed && epoch === this.epoch && revision === this.revision) {
          this.dirty = false; this.needsWriteback = false; this.recovered = false; this.status = 'ready';
        }
      } catch { if (!this.destroyed && epoch === this.epoch && revision === this.revision) this.status = 'saveError'; }
    }).finally(() => {
      this.requests.delete(request); this.saving = this.requests.size > 0; this.emit();
    });
    const request: SaveRequest = { revision, epoch, dto, promise };
    this.requests.add(request); this.queue = promise;
    this.emit();
    await promise;
  }

  destroy(): void { this.destroyed = true; ++this.epoch; ++this.readGeneration; this.listeners.clear(); }
}
