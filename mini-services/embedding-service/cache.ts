interface CacheEntry {
  value: number[];
  expiresAt: number;
}

export class EmbeddingCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries = 10000, defaultTtlMs = 24 * 60 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): number[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key: string, value: number[], ttlMs?: number): void {
    // If key already exists, delete it first to re-insert at end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict least recently used entries if at capacity
    while (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    // Move to end on access
    this.cache.delete(key);
    this.cache.set(key, entry);

    return true;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    // Prune expired entries for accurate count
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }
}