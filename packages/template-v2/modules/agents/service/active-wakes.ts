/**
 * `active_wakes` coordination primitive.
 *
 * The UNLOGGED `agents.active_wakes` table is the in-flight debounce record.
 * Every wake acquires a lease keyed by conversation_id; inbound messages that
 * arrive while a lease is held are steered via `pg_notify('wake:<worker>')`
 * instead of enqueuing a fresh job.
 *
 * Operations are written as raw SQL so the driver stays drizzle-free —
 * callers pass in the `postgres.Sql` handle already on ctx.db.
 */

export interface ActiveWakesDb {
  /** Minimal tagged-template `postgres` Sql interface. */
  <T extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>
  unsafe?: (stmt: string, values?: unknown[]) => Promise<unknown>
}

/**
 * Atomically acquire (or reclaim a stale) lease for a conversation. Returns
 * `true` when the caller holds the lease.
 */
export async function acquire(
  sql: ActiveWakesDb,
  conversationId: string,
  workerId: string,
  debounceMs: number,
): Promise<boolean> {
  const debounceSeconds = Math.max(1, Math.round(debounceMs / 1000))
  const rows = await sql<{ acquired: boolean }>`
    INSERT INTO agents.active_wakes (conversation_id, worker_id, debounce_until)
    VALUES (${conversationId}, ${workerId}, now() + (${debounceSeconds} || ' seconds')::interval)
    ON CONFLICT (conversation_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      started_at = now(),
      debounce_until = EXCLUDED.debounce_until
      WHERE agents.active_wakes.debounce_until < now()
    RETURNING worker_id = ${workerId} AS acquired
  `
  return rows[0]?.acquired === true
}

/** Release the lease (called when the wake completes or aborts). */
export async function release(sql: ActiveWakesDb, conversationId: string, workerId: string): Promise<void> {
  await sql`
    DELETE FROM agents.active_wakes
    WHERE conversation_id = ${conversationId} AND worker_id = ${workerId}
  `
}

/**
 * Lookup the worker currently holding the lease for a conversation. Returns
 * `null` when the lease is free or expired.
 */
export async function getWorker(sql: ActiveWakesDb, conversationId: string): Promise<string | null> {
  const rows = await sql<{ worker_id: string }>`
    SELECT worker_id FROM agents.active_wakes
    WHERE conversation_id = ${conversationId} AND debounce_until > now()
    LIMIT 1
  `
  return rows[0]?.worker_id ?? null
}

/** Sweep leases left behind by crashed workers (>1m past their debounce). */
export async function sweepStale(sql: ActiveWakesDb): Promise<number> {
  const rows = await sql<{ count: string }>`
    WITH deleted AS (
      DELETE FROM agents.active_wakes
      WHERE debounce_until < now() - interval '1 minute'
      RETURNING conversation_id
    )
    SELECT count(*)::text AS count FROM deleted
  `
  return Number(rows[0]?.count ?? '0')
}

/**
 * In-process fake used by unit tests. Matches the production semantics: one
 * lease per conversationId, stale-reclaim based on mock time.
 */
export interface ActiveWakesStore {
  acquire(conversationId: string, workerId: string, debounceMs: number): Promise<boolean>
  release(conversationId: string, workerId: string): Promise<void>
  getWorker(conversationId: string): Promise<string | null>
  advance(ms: number): void
}

export function createInMemoryActiveWakes(): ActiveWakesStore {
  const leases = new Map<string, { workerId: string; debounceUntil: number }>()
  let clock = 0
  return {
    async acquire(conversationId, workerId, debounceMs): Promise<boolean> {
      const existing = leases.get(conversationId)
      if (existing && existing.debounceUntil > clock) return existing.workerId === workerId
      leases.set(conversationId, { workerId, debounceUntil: clock + debounceMs })
      return true
    },
    async release(conversationId, workerId): Promise<void> {
      const existing = leases.get(conversationId)
      if (existing && existing.workerId === workerId) leases.delete(conversationId)
    },
    async getWorker(conversationId): Promise<string | null> {
      const existing = leases.get(conversationId)
      if (!existing) return null
      if (existing.debounceUntil <= clock) return null
      return existing.workerId
    },
    advance(ms: number): void {
      clock += ms
    },
  }
}
