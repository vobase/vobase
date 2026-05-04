/**
 * Sliding-window rate limiter backed by Postgres `now()`.
 *
 * Why Postgres-side time? Wall-clock skew across template instances can
 * widen or shrink the window; `now()` is a single monotonic source per
 * cluster, so two instances acquiring against the same key see the same
 * window edge.
 *
 * The `acquire` call is one round-trip:
 *
 *   WITH pruned AS (DELETE … WHERE hit_at < now() - window),
 *        counted AS (SELECT count(*) FROM rate_limits WHERE key = $1 AND hit_at >= now() - window),
 *        inserted AS (INSERT … SELECT … WHERE (SELECT count … ) < $2)
 *   SELECT … allowed, retry_after
 *
 * Approved hits return `{ ok: true, retryAfter: null }`. Rejected hits
 * return `{ ok: false, retryAfter: <oldest-hit + window> }` so callers can
 * surface a concrete `Retry-After` header to the caller.
 *
 * The table is pruned opportunistically (every `acquire` deletes expired
 * rows for the same key); a separate periodic vacuum is unnecessary at
 * sane (`limit` × `key cardinality`) volumes.
 */
import { type SQL, sql } from 'drizzle-orm'

/**
 * Minimal structural db shape — any drizzle handle (postgres-js, pglite, …)
 * exposes `execute(sql)` and returns either an array of rows or `{ rows }`.
 * Keeping the limiter generic over this shape avoids a hard dependency on
 * `VobaseDb`, so template-narrowed `ScopedDb` (postgres-js) and the in-test
 * PGlite handle are both accepted without an unsafe `as` cast at the call
 * site. We type the result as `unknown` and narrow inside the limiter — the
 * shape is enforced by the SQL projection, not by drizzle's row type.
 */
export interface RateLimitDb {
  execute(query: SQL): Promise<unknown>
}

export interface RateLimiter {
  /**
   * Try to record a hit against `key`. Returns `{ ok: true }` if within the
   * sliding window of `limit` hits over the last `windowSeconds`, otherwise
   * returns `{ ok: false, retryAfter }` where `retryAfter` is the wall-clock
   * instant the oldest in-window hit will expire.
   */
  acquire(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfter: Date | null }>
}

interface AcquireRow extends Record<string, unknown> {
  allowed: boolean
  retry_after: Date | string | null
}

/**
 * Build a rate limiter bound to `db`. The handle is cheap; consumers are
 * free to construct one per-call or hold a singleton.
 */
export function createRateLimiter(db: RateLimitDb): RateLimiter {
  return {
    async acquire(
      key: string,
      limit: number,
      windowSeconds: number,
    ): Promise<{ ok: boolean; retryAfter: Date | null }> {
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error(`rate-limit: limit must be a positive integer (got ${limit})`)
      }
      if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
        throw new Error(`rate-limit: windowSeconds must be > 0 (got ${windowSeconds})`)
      }

      // The inserted row's `seq` is `(count of in-window hits + 1)` so the
      // composite PK never collides for the same key inside a single
      // microsecond. The CTE evaluates `count(*)` once; both the insert
      // gate and the seq derivation read from the same snapshot.
      const window = sql.raw(`interval '${windowSeconds} seconds'`)
      const limitVal = sql.raw(String(limit))
      const result = await db.execute(sql`
        WITH pruned AS (
          DELETE FROM "infra"."rate_limits"
          WHERE key = ${key} AND hit_at < (now() - ${window})
          RETURNING 1
        ),
        live AS (
          SELECT count(*)::int AS n
          FROM "infra"."rate_limits"
          WHERE key = ${key} AND hit_at >= (now() - ${window})
        ),
        ins AS (
          INSERT INTO "infra"."rate_limits" (key, hit_at, seq)
          SELECT ${key}, now(), (SELECT n + 1 FROM live)
          WHERE (SELECT n FROM live) < ${limitVal}
          RETURNING hit_at
        )
        SELECT
          (SELECT count(*) FROM ins) > 0 AS allowed,
          CASE
            WHEN (SELECT count(*) FROM ins) > 0 THEN NULL
            ELSE (
              SELECT min(hit_at) + ${window}
              FROM "infra"."rate_limits"
              WHERE key = ${key} AND hit_at >= (now() - ${window})
            )
          END AS retry_after
      `)

      const rows = (result as { rows?: AcquireRow[] }).rows ?? (result as unknown as AcquireRow[])
      const row = rows[0]
      if (!row) {
        // Defensive — the CTE always returns one row.
        return { ok: false, retryAfter: null }
      }

      const allowed = row.allowed === true || (row.allowed as unknown) === 't'
      const retryAfter =
        row.retry_after === null || row.retry_after === undefined
          ? null
          : row.retry_after instanceof Date
            ? row.retry_after
            : new Date(row.retry_after)

      return { ok: allowed, retryAfter }
    },
  }
}
