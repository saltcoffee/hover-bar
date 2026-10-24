import { DEFAULTS, parsePreferences, type PreferenceKey, type Preferences } from './model';

export type StoreStatus = 'ready' | 'loadError' | 'schemaError' | 'saveError' | 'conflict';
interface Persistence { load(): Promise<unknown>; save(value: Preferences): Promise<void> }

export class PreferencesStore {
  value: Preferences = { ...DEFAULTS };
  status: StoreStatus = 'loadError';
  recovered = false;
  private dirty = false;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(private readonly persistence: Persistence) {}
  get enabled(): boolean { return this.status === 'ready' || this.status === 'saveError'; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }

  async load(): Promise<void> {
    const generation = ++this.generation;
    await this.queue;
    try {
      const parsed = parsePreferences(await this.persistence.load());
      if (generation !== this.generation) return;
      this.value = parsed.value; this.recovered = parsed.recovered;
      this.status = 'ready'; this.dirty = false;
    } catch (error) {
      if (generation !== this.generation) return;
      this.status = error instanceof Error && error.message === 'schema' ? 'schemaError' : 'loadError';
    }
    this.emit();
  }

  async externalChange(): Promise<void> {
    if (this.dirty) { ++this.generation; this.status = 'conflict'; this.emit(); }
    else await this.load();
  }

  async set(key: PreferenceKey, value: boolean): Promise<void> {
    if (!this.enabled || this.value[key] === value) return;
    this.value = { ...this.value, [key]: value };
    this.emit();
    await this.save();
  }

  async reset(): Promise<void> {
    if (!this.enabled) return;
    this.value = { ...DEFAULTS }; this.recovered = false; this.emit();
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.enabled) return;
    this.dirty = true;
    const snapshot = { ...this.value };
    const generation = ++this.generation;
    this.queue = this.queue.then(async () => {
      if (this.status === 'conflict') return;
      try {
        await this.persistence.save(snapshot);
        if (generation === this.generation) { this.dirty = false; this.status = 'ready'; }
      } catch { if (generation === this.generation) this.status = 'saveError'; }
      this.emit();
    });
    await this.queue;
  }
}
