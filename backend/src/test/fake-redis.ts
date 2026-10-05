/**
 * Minimal in-memory stand-in for the ioredis commands RidesService uses
 * (R-5 timer tests). Not a general-purpose Redis: only the sorted-set
 * operations behind `ride:timers` are implemented, and `zrem` mirrors the
 * real atomic claim (exactly one caller gets `1` for a member).
 *
 * Shared instances model a shared Redis server: two services constructed with
 * the SAME FakeRedis are "two backend instances".
 */
export class FakeRedis {
  private readonly zsets = new Map<string, Map<string, number>>();

  /** ZADD key score member — creates or updates (returns 0 when updated). */
  async zadd(key: string, score: number, member: string): Promise<number> {
    const z = this.zsets.get(key) ?? new Map<string, number>();
    this.zsets.set(key, z);
    const existed = z.has(member);
    z.set(member, score);
    return existed ? 0 : 1;
  }

  /** ZREM key member — the atomic claim: 1 to the first caller, 0 to the rest. */
  async zrem(key: string, member: string): Promise<number> {
    const z = this.zsets.get(key);
    if (!z || !z.has(member)) return 0;
    z.delete(member);
    return 1;
  }

  /** ZRANGEBYSCORE key min max — members with min <= score <= max, sorted. */
  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const z = this.zsets.get(key);
    if (!z) return [];
    return [...z.entries()]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  }

  /** ZSCORE key member — due time in ms, or null when absent. */
  async zscore(key: string, member: string): Promise<number | null> {
    const score = this.zsets.get(key)?.get(member);
    return score === undefined ? null : score;
  }

  /** ZCARD key — how many timers are armed. */
  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }
}
