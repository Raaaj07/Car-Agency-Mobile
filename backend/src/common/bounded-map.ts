/**
 * A Map that never holds more than `max` entries. Inserting past the cap
 * evicts the oldest entry (Map keeps insertion order; re-setting a key moves
 * it to the newest position). Used for in-memory caches that are keyed by
 * client-influenced values (coordinates, place ids), so a caller walking
 * across many distinct keys cannot grow the process heap without limit.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly max: number) {
    super();
  }

  override set(key: K, value: V): this {
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    while (this.size > this.max) {
      const oldest = this.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    return this;
  }
}
