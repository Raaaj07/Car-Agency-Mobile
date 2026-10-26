/**
 * Minimal in-memory stand-in for the ioredis commands the backend services
 * use in tests. Not a general-purpose Redis: only the operations behind
 * `ride:timers` (R-5) and `drivers:geo` / `driver:lastseen` (D-3) are
 * implemented, and `zrem` mirrors the real atomic claim (exactly one caller
 * gets `1` for a member).
 *
 * Shared instances model a shared Redis server: two services constructed with
 * the SAME FakeRedis are "two backend instances".
 */

import { OTP_VERIFY_SCRIPT } from '../auth/otp.service';

type ScoreBound = number | '-inf' | '+inf';

export interface FakePipeline {
  zrem(key: string, member: string): FakePipeline;
  del(...keys: string[]): FakePipeline;
  exec(): Promise<unknown[]>;
}

const toScore = (bound: ScoreBound): number => {
  if (typeof bound === 'number') return bound;
  return bound === '-inf' ? -Infinity : Infinity;
};

export class FakeRedis {
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly hashes = new Map<string, Map<string, string>>();
  // Coordinate sidecar for GEO members. Membership itself lives in `zsets`
  // (like real Redis, where GEOADD is ZADD with an encoded score), so ZREM/DEL
  // remove geo members exactly as the production sweep expects.
  private readonly geoCoords = new Map<string, Map<string, { lng: number; lat: number }>>();
  private readonly ttls = new Map<string, number>();
  // Plain string keys (OTP codes etc). No TTL modelling: tests set and read
  // values directly.
  private readonly strings = new Map<string, string>();

  /** GET key — string value or null. */
  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  /** SET key value [EX seconds] — EX accepted and ignored (no string TTLs). */
  async set(key: string, value: string, ..._rest: unknown[]): Promise<'OK'> {
    this.strings.set(key, value);
    return 'OK';
  }

  /**
   * EVAL of the OTP verify script (atomic get+compare+consume, 1/0/-1) —
   * the only script the backend runs today. Anything else is unsupported on
   * purpose: a permissive fake would hide a new EVAL call from tests.
   */
  async eval(script: string, _numKeys: number, ...args: Array<string | number>): Promise<number> {
    if (script !== OTP_VERIFY_SCRIPT) {
      throw new Error('FakeRedis: unsupported EVAL script');
    }
    const [key, code] = args.map(String);
    const stored = this.strings.get(key);
    if (stored === undefined) return -1;
    if (stored === code) {
      this.strings.delete(key);
      return 1;
    }
    return 0;
  }

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
    this.geoCoords.get(key)?.delete(member);
    if (!z || !z.has(member)) return 0;
    z.delete(member);
    return 1;
  }

  /** ZRANGEBYSCORE key min max — members with min <= score <= max, sorted. */
  async zrangebyscore(key: string, min: ScoreBound, max: ScoreBound): Promise<string[]> {
    const z = this.zsets.get(key);
    if (!z) return [];
    const lo = toScore(min);
    const hi = toScore(max);
    return [...z.entries()]
      .filter(([, score]) => score >= lo && score <= hi)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  }

  /** ZSCORE key member — score in ms, or null when absent. */
  async zscore(key: string, member: string): Promise<number | null> {
    const score = this.zsets.get(key)?.get(member);
    return score === undefined ? null : score;
  }

  /** ZCARD key — how many members the set holds. */
  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  /** GEOADD key lng lat member — coordinates recorded, membership in the zset. */
  async geoadd(key: string, lng: number, lat: number, member: string): Promise<number> {
    const coords = this.geoCoords.get(key) ?? new Map<string, { lng: number; lat: number }>();
    this.geoCoords.set(key, coords);
    const existed = coords.has(member);
    coords.set(member, { lng, lat });
    await this.zadd(key, 0, member); // score is meaningless for geo in this fake
    return existed ? 0 : 1;
  }

  /** Test helper: stored coordinates for a geo member (ioredis geopos shape). */
  async geopos(key: string, member: string): Promise<{ lng: number; lat: number } | null> {
    if (!this.zsets.get(key)?.has(member)) return null; // membership wins, like Redis
    return this.geoCoords.get(key)?.get(member) ?? null;
  }

  /** HSET key field value (object form as used by GeoService). */
  async hset(key: string, fields: Record<string, string>): Promise<number> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    this.hashes.set(key, h);
    let added = 0;
    for (const [field, value] of Object.entries(fields)) {
      if (!h.has(field)) added += 1;
      h.set(field, value);
    }
    return added;
  }

  /** HGET key field — value or null when key/field missing. */
  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  /** EXPIRE key seconds — stores the TTL for assertions. */
  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds);
    return 1;
  }

  /** TTL key — seconds, -1 when the key has no TTL, -2 when missing. */
  async ttl(key: string): Promise<number> {
    if (!this.exists(key)) return -2;
    return this.ttls.get(key) ?? -1;
  }

  /** INCR key — parses the stored string (missing = 0), returns the new value. */
  async incr(key: string): Promise<number> {
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }

  /** PEXPIRE key ms — stores the TTL (seconds, rounded up, like real Redis). */
  async pexpire(key: string, ms: number): Promise<number> {
    if (!this.exists(key)) return 0;
    this.ttls.set(key, Math.ceil(ms / 1000));
    return 1;
  }

  /** PTTL key — milliseconds, -1 when the key has no TTL, -2 when missing. */
  async pttl(key: string): Promise<number> {
    if (!this.exists(key)) return -2;
    const seconds = this.ttls.get(key);
    return seconds === undefined ? -1 : seconds * 1000;
  }

  /** PSETEX key ms value — set the string value with a millisecond TTL. */
  async psetex(key: string, ms: number, value: string): Promise<'OK'> {
    this.strings.set(key, value);
    this.ttls.set(key, Math.ceil(ms / 1000));
    return 'OK';
  }

  /** DEL key [key …] — removes zsets/hashes/geo coords/strings (and their TTLs). */
  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.zsets.delete(key)) removed += 1;
      if (this.hashes.delete(key)) removed += 1;
      if (this.geoCoords.delete(key)) removed += 1;
      if (this.strings.delete(key)) removed += 1;
      this.ttls.delete(key);
    }
    return removed;
  }

  /** ioredis-style pipeline: queues commands, runs them in order on exec(). */
  pipeline(): FakePipeline {
    const ops: Array<() => Promise<unknown>> = [];
    const pipe: FakePipeline = {
      zrem: (key, member) => {
        ops.push(() => this.zrem(key, member));
        return pipe;
      },
      del: (...keys) => {
        ops.push(() => this.del(...keys));
        return pipe;
      },
      exec: async () => {
        const results: unknown[] = [];
        for (const op of ops) results.push(await op());
        return results;
      },
    };
    return pipe;
  }

  private exists(key: string): boolean {
    return (
      this.zsets.has(key) ||
      this.hashes.has(key) ||
      this.geoCoords.has(key) ||
      this.strings.has(key)
    );
  }
}
