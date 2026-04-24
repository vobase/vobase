/**
 * `harness.active_wakes` coordination primitive.
 *
 * The UNLOGGED `harness.active_wakes` table is the in-flight debounce record.
 * Every wake acquires a lease keyed by conversation_id; inbound messages that
 * arrive while a lease is held are steered via `pg_notify('wake:<worker>')`
 * instead of enqueuing a fresh job.
 */

import { and, eq, lt, sql } from 'drizzle-orm'

import type { VobaseDb } from '../db/client'
import { activeWakes } from '../schemas/harness'

/**
 * Atomically acquire (or reclaim a stale) lease for a conversation. Returns
 * `true` when the caller holds the lease.
 */
export async function acquire(
  db: VobaseDb,
  conversationId: string,
  workerId: string,
  debounceMs: number,
): Promise<boolean> {
  const debounceSeconds = Math.max(1, Math.round(debounceMs / 1000))
  const debounceUntil = sql`now() + make_interval(secs => ${debounceSeconds})`

  const rows = await db
    .insert(activeWakes)
    .values({
      conversationId,
      workerId,
      debounceUntil: debounceUntil as unknown as Date,
    })
    .onConflictDoUpdate({
      target: activeWakes.conversationId,
      set: {
        workerId: sql`excluded.worker_id`,
        startedAt: sql`now()`,
        debounceUntil: sql`excluded.debounce_until`,
      },
      setWhere: lt(activeWakes.debounceUntil, sql`now()`),
    })
    .returning({ acquired: sql<boolean>`${activeWakes.workerId} = ${workerId}` })

  return rows[0]?.acquired === true
}

/** Release the lease (called when the wake completes or aborts). */
export async function release(db: VobaseDb, conversationId: string, workerId: string): Promise<void> {
  await db
    .delete(activeWakes)
    .where(and(eq(activeWakes.conversationId, conversationId), eq(activeWakes.workerId, workerId)))
}

/**
 * Lookup the worker currently holding the lease for a conversation. Returns
 * `null` when the lease is free or expired.
 */
export async function getWorker(db: VobaseDb, conversationId: string): Promise<string | null> {
  const rows = await db
    .select({ workerId: activeWakes.workerId })
    .from(activeWakes)
    .where(and(eq(activeWakes.conversationId, conversationId), sql`${activeWakes.debounceUntil} > now()`))
    .limit(1)
  return rows[0]?.workerId ?? null
}

/** Sweep leases left behind by crashed workers (>1m past their debounce). */
export async function sweepStale(db: VobaseDb): Promise<number> {
  const deleted = await db
    .delete(activeWakes)
    .where(lt(activeWakes.debounceUntil, sql`now() - interval '1 minute'`))
    .returning({ conversationId: activeWakes.conversationId })
  return deleted.length
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
    acquire(conversationId, workerId, debounceMs): Promise<boolean> {
      const existing = leases.get(conversationId)
      if (existing && existing.debounceUntil > clock) {
        return Promise.resolve(existing.workerId === workerId)
      }
      leases.set(conversationId, {
        workerId,
        debounceUntil: clock + debounceMs,
      })
      return Promise.resolve(true)
    },
    release(conversationId, workerId): Promise<void> {
      const existing = leases.get(conversationId)
      if (existing && existing.workerId === workerId) leases.delete(conversationId)
      return Promise.resolve()
    },
    getWorker(conversationId): Promise<string | null> {
      const existing = leases.get(conversationId)
      if (!existing) return Promise.resolve(null)
      if (existing.debounceUntil <= clock) return Promise.resolve(null)
      return Promise.resolve(existing.workerId)
    },
    advance(ms: number): void {
      clock += ms
    },
  }
}
