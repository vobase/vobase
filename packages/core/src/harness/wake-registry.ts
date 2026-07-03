/**
 * `harness.active_wakes` coordination primitive.
 *
 * The UNLOGGED `harness.active_wakes` table is the in-flight debounce record. Every wake acquires a lease keyed by conversation_id; inbound messages that arrive while a lease is held are steered via `pg_notify('wake:<worker>')` instead of enqueuing a fresh job.
 *
 * ## Sweep gating
 *
 * `sweepStale` is driven from an unconditional interval (60s in the template bootstrap). On Neon, an unconditional periodic query resets the compute's autosuspend timer and pins it at the CU floor 24/7, so the sweep gates itself on in-process lease activity: it only issues the DELETE while a lease acquired by this process could still be awaiting GC (plus one armed sweep at boot to clear leftovers from a crashed previous instance). This assumes the single-process deployment the in-process job queue already requires — with multiple writer processes on one database, a lease from a crashed sibling is still reclaimed by `acquire`'s stale-reclaim path, it just isn't GC'd by an idle survivor's sweep.
 */

import { and, eq, lt, sql } from 'drizzle-orm'

import type { VobaseDb } from '../db/client'
import { activeWakes } from '../schemas/harness'

/** Margin past `debounce_until` before a lease is sweepable — mirrors the `interval '1 minute'` in `sweepStale`. */
const SWEEP_STALE_GRACE_MS = 60_000

/** Armed at boot so the first sweep clears leases left by a crashed previous process. */
let sweepArmed = true
/** Bumped on every acquire so a sweep racing an acquire never disarms the gate. */
let acquireEpoch = 0
/** Latest instant any lease acquired by this process could become sweepable. */
let lastLeaseStaleAtMs = 0
let sweepGraceMs = SWEEP_STALE_GRACE_MS

/** Test hook — resets the sweep gate to boot state; `graceMs` shrinks the quiesce window. */
export function __resetSweepGateForTests(opts?: { graceMs?: number }): void {
  sweepArmed = true
  acquireEpoch = 0
  lastLeaseStaleAtMs = 0
  sweepGraceMs = opts?.graceMs ?? SWEEP_STALE_GRACE_MS
}

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
  acquireEpoch += 1
  sweepArmed = true
  const staleAtMs = Date.now() + debounceMs + sweepGraceMs
  if (staleAtMs > lastLeaseStaleAtMs) lastLeaseStaleAtMs = staleAtMs

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

/**
 * Sweep leases left behind by crashed workers (>1m past their debounce).
 *
 * No-ops without touching the database while the gate is disarmed (see module docs) so an idle process lets Neon autosuspend. Disarms only once a sweep finds nothing to delete, no acquire raced it, and every lease this process ever acquired is past its sweepable horizon — a crashed-mid-wake lease is therefore always swept before the gate quiesces.
 */
export async function sweepStale(db: VobaseDb): Promise<number> {
  if (!sweepArmed) return 0
  const epochAtStart = acquireEpoch
  const deleted = await db
    .delete(activeWakes)
    .where(lt(activeWakes.debounceUntil, sql`now() - interval '1 minute'`))
    .returning({ conversationId: activeWakes.conversationId })
  if (deleted.length === 0 && acquireEpoch === epochAtStart && Date.now() >= lastLeaseStaleAtMs) {
    sweepArmed = false
  }
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
