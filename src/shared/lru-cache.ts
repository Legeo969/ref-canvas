/**
 * Small in-memory least-recently-used cache for session-scoped data.
 * Reading an entry refreshes its recency; inserting past capacity evicts the
 * least recently read or written entry.
 */
export class LruCache<TKey, TValue> {
  private readonly entries = new Map<TKey, TValue>();

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("LRU_CACHE_CAPACITY_INVALID");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  delete(key: TKey): boolean {
    return this.entries.delete(key);
  }

  get(key: TKey): TValue | undefined {
    const value = this.entries.get(key);
    if (value === undefined && !this.entries.has(key)) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value as TValue);
    return value;
  }

  has(key: TKey): boolean {
    if (!this.entries.has(key)) return false;
    const value = this.entries.get(key) as TValue;
    this.entries.delete(key);
    this.entries.set(key, value);
    return true;
  }

  set(key: TKey, value: TValue): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size <= this.capacity) return;
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) this.entries.delete(oldest);
  }
}
