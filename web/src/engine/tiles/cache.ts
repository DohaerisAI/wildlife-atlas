/** Least-recently-used cache with a count budget; entries the caller still needs this frame are never evicted. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly budget: number, private readonly dispose: (value: V, key: string) => void = () => {}) {
    if (!(budget > 0)) throw new RangeError('cache budget must be positive');
  }

  get size(): number { return this.map.size; }
  has(key: string): boolean { return this.map.has(key); }

  /** Read and mark as recently used. */
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) { this.map.delete(key); this.map.set(key, v); }
    return v;
  }

  set(key: string, value: V): void {
    const old = this.map.get(key);
    if (old !== undefined && old !== value) this.dispose(old, key);
    this.map.delete(key);
    this.map.set(key, value);
  }

  /** Drop the oldest entries until within budget, skipping `keep`. Returns the keys dropped. */
  evict(keep: ReadonlySet<string>): string[] {
    const dropped: string[] = [];
    for (const [key, value] of this.map) {
      if (this.map.size <= this.budget) break;
      if (keep.has(key)) continue;
      this.map.delete(key);
      this.dispose(value, key);
      dropped.push(key);
    }
    return dropped;
  }

  clear(): void {
    this.map.forEach((v, k) => this.dispose(v, k));
    this.map.clear();
  }
}
