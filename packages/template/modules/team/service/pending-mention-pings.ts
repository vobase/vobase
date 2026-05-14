/**
 * TTL ledger for outbound `@-mention` pings on the notification-tier WhatsApp
 * channel.
 *
 * - Written by `team/service/mention-notify.ts` after a successful WA send,
 *   carrying the send's `outboundWamid` when the provider returned one.
 * - Claimed by the inbound notifications handler when a staff WhatsApp reply
 *   arrives, via a two-rung ladder (`claimPing`):
 *     1. Exact match — if the inbound carries a `context.id` (the quoted-message
 *        wamid, present only when staff use WhatsApp's native reply gesture),
 *        atomically claim the ping whose `outboundWamid` equals it.
 *     2. Count-aware — otherwise, claim iff the staff member has exactly one
 *        live ping. Two or more is `ambiguous` (we refuse to guess which
 *        conversation the reply answers); zero is `none`. Both fall through to
 *        operator-thread chat in the caller.
 *   Every claim is an atomic `DELETE … RETURNING`, so a ping can never be
 *   claimed twice and concurrent/redelivered inbounds are race-safe.
 *
 * TTL semantics: a ping older than `PING_TTL_MS` (30 minutes) is treated as
 * stale and ignored — the staff member's reply becomes operator-thread chat
 * instead. Read-time TTL filter is the primary cleanup; a periodic prune job
 * can remove abandoned rows but is not required for correctness.
 */

import { type PendingMentionPing, pendingMentionPings } from '@modules/team/schema'
import { sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

/** 30-minute TTL. Pings older than this are treated as stale. */
export const PING_TTL_MS = 30 * 60 * 1000

export interface RecordPingInput {
  conversationId: string
  staffUserId: string
  organizationId: string
  askingAgentId: string
  originalNoteId: string
  /** wamid of the outbound WA ping, when the provider returned one. */
  outboundWamid?: string | null
}

export interface ClaimPingInput {
  staffUserId: string
  /**
   * Scopes the claim to the calling org — prevents cross-tenant collision when
   * the same staff phone is linked to multiple tenants on the same platform.
   */
  organizationId: string
  /**
   * The inbound reply's `context.id` (quoted-message wamid). When present, the
   * exact-match rung is tried first; on a miss the count-aware rung still runs.
   */
  outboundWamid?: string | null
}

/**
 * Outcome of a `claimPing` call:
 * - `claimed`   — a single ping was atomically claimed; route the reply as an
 *                 ask-staff-answer internal note that wakes `ping.askingAgentId`.
 * - `none`      — no live ping; the reply is a fresh staff-initiated message.
 * - `ambiguous` — the staff member has `liveCount` (≥2) live pings and the
 *                 inbound carried no exact wamid match, so we refuse to guess.
 */
export type ClaimPingResult =
  | { status: 'claimed'; ping: PendingMentionPing }
  | { status: 'none' }
  | { status: 'ambiguous'; liveCount: number }

export interface PendingMentionPingService {
  recordPing(input: RecordPingInput): Promise<void>
  /**
   * Atomically claim a ping for this (staff, org) tuple via the two-rung
   * ladder (see file header). Every successful claim is a `DELETE … RETURNING`,
   * so a row can never be claimed twice.
   */
  claimPing(input: ClaimPingInput): Promise<ClaimPingResult>
  /** Delete rows older than the cutoff. Returns count removed. */
  pruneOlderThan(cutoff: Date): Promise<number>
}

interface PingDeps {
  db: ScopedDb
}

/**
 * Raw row shape from `DELETE … RETURNING` / the count-aware CTE. Columns are
 * nullable because the count-aware statement `LEFT JOIN`s the deleted row onto
 * a single-row spine — when nothing was deleted, every payload column is null
 * and only `live_count` is populated.
 */
interface RawPingRow extends Record<string, unknown> {
  id: string | null
  conversation_id: string | null
  staff_user_id: string | null
  organization_id: string | null
  asking_agent_id: string | null
  original_note_id: string | null
  outbound_wamid: string | null
  created_at: string | Date | null
  live_count?: number | string | null
}

/**
 * A `RawPingRow` whose payload columns are populated — a real
 * `DELETE … RETURNING` row, not the empty-spine row the count-aware CTE yields
 * when nothing was deleted. `isClaimedRow` is the only way to obtain one.
 */
interface ClaimedPingRow extends RawPingRow {
  id: string
  conversation_id: string
  staff_user_id: string
  organization_id: string
  asking_agent_id: string
  original_note_id: string
  created_at: string | Date
}

const PING_COLUMNS = sql`id, conversation_id, staff_user_id, organization_id, asking_agent_id, original_note_id, outbound_wamid, created_at`

/** Normalise drizzle's `db.execute` return (postgres-js array vs `{ rows }`). */
function extractRows(result: unknown): RawPingRow[] {
  if (Array.isArray(result)) return result as RawPingRow[]
  return (result as { rows?: RawPingRow[] }).rows ?? []
}

/**
 * A populated `id` only ever comes back on a real deleted row, and the table's
 * payload columns are all `.notNull()` — so a present `id` implies the rest.
 */
function isClaimedRow(row: RawPingRow | undefined): row is ClaimedPingRow {
  return typeof row?.id === 'string'
}

function rowToPing(row: ClaimedPingRow): PendingMentionPing {
  return {
    conversationId: row.conversation_id,
    staffUserId: row.staff_user_id,
    organizationId: row.organization_id,
    askingAgentId: row.asking_agent_id,
    originalNoteId: row.original_note_id,
    outboundWamid: row.outbound_wamid,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  }
}

export function createPendingMentionPingService(deps: PingDeps): PendingMentionPingService {
  const db = deps.db

  async function recordPing(input: RecordPingInput): Promise<void> {
    await db
      .insert(pendingMentionPings)
      .values({
        conversationId: input.conversationId,
        staffUserId: input.staffUserId,
        organizationId: input.organizationId,
        askingAgentId: input.askingAgentId,
        originalNoteId: input.originalNoteId,
        outboundWamid: input.outboundWamid ?? null,
      })
      .onConflictDoUpdate({
        target: [pendingMentionPings.conversationId, pendingMentionPings.staffUserId],
        set: {
          askingAgentId: input.askingAgentId,
          originalNoteId: input.originalNoteId,
          organizationId: input.organizationId,
          outboundWamid: input.outboundWamid ?? null,
          createdAt: new Date(),
        },
      })
  }

  // postgres-js does not auto-bind Date in raw `sql\`…${date}…\``; the cutoff is
  // passed as an ISO string and cast to timestamptz at the DB boundary.
  function ttlCutoffIso(): string {
    return new Date(Date.now() - PING_TTL_MS).toISOString()
  }

  /** Rung 1 — exact wamid match. Null when no row matches (caller falls through). */
  async function claimByWamid(input: ClaimPingInput, wamid: string): Promise<PendingMentionPing | null> {
    const result = await db.execute<RawPingRow>(sql`
      DELETE FROM ${pendingMentionPings}
      WHERE id = (
        SELECT id FROM ${pendingMentionPings}
        WHERE staff_user_id = ${input.staffUserId}
          AND organization_id = ${input.organizationId}
          AND outbound_wamid = ${wamid}
          AND created_at > ${ttlCutoffIso()}::timestamptz
        ORDER BY created_at DESC
        LIMIT 1
      )
      RETURNING ${PING_COLUMNS}
    `)
    const row = extractRows(result)[0]
    return isClaimedRow(row) ? rowToPing(row) : null
  }

  /**
   * Rung 2 — count-aware. One atomic statement: the `live` CTE is the shared
   * snapshot, `deleted` only fires when that snapshot holds exactly one row,
   * and the `LEFT JOIN` onto a single-row spine guarantees one result row even
   * when nothing was deleted — so the caller always gets `live_count` back.
   */
  async function claimSoleLivePing(input: ClaimPingInput): Promise<ClaimPingResult> {
    const result = await db.execute<RawPingRow>(sql`
      WITH live AS (
        SELECT id FROM ${pendingMentionPings}
        WHERE staff_user_id = ${input.staffUserId}
          AND organization_id = ${input.organizationId}
          AND created_at > ${ttlCutoffIso()}::timestamptz
      ),
      deleted AS (
        DELETE FROM ${pendingMentionPings}
        WHERE id IN (SELECT id FROM live)
          AND (SELECT count(*) FROM live) = 1
        RETURNING ${PING_COLUMNS}
      )
      SELECT (SELECT count(*)::int FROM live) AS live_count,
             d.id, d.conversation_id, d.staff_user_id, d.organization_id,
             d.asking_agent_id, d.original_note_id, d.outbound_wamid, d.created_at
      FROM (SELECT 1) AS _spine
      LEFT JOIN deleted d ON true
    `)
    const row = extractRows(result)[0]
    const liveCount = Number(row?.live_count ?? 0)
    if (liveCount === 1 && isClaimedRow(row)) return { status: 'claimed', ping: rowToPing(row) }
    if (liveCount >= 2) return { status: 'ambiguous', liveCount }
    return { status: 'none' }
  }

  async function claimPing(input: ClaimPingInput): Promise<ClaimPingResult> {
    if (input.outboundWamid) {
      const exact = await claimByWamid(input, input.outboundWamid)
      if (exact) return { status: 'claimed', ping: exact }
      // wamid miss — staff replied to a stale/expired ping or to something
      // that isn't a ping at all; fall through to the count-aware rung.
    }
    return claimSoleLivePing(input)
  }

  async function pruneOlderThan(cutoff: Date): Promise<number> {
    const cutoffIso = cutoff.toISOString()
    const result = await db.execute<RawPingRow>(sql`
      DELETE FROM ${pendingMentionPings}
      WHERE created_at < ${cutoffIso}::timestamptz
      RETURNING id
    `)
    return extractRows(result).length
  }

  return { recordPing, claimPing, pruneOlderThan }
}

let _current: PendingMentionPingService | null = null
export function installPendingMentionPingService(svc: PendingMentionPingService): void {
  _current = svc
}
export function __resetPendingMentionPingServiceForTests(): void {
  _current = null
}
function current(): PendingMentionPingService {
  if (!_current) {
    throw new Error(
      'team/pending-mention-pings: service not installed — call installPendingMentionPingService() in module init',
    )
  }
  return _current
}

export const recordPing: PendingMentionPingService['recordPing'] = (i) => current().recordPing(i)
export const claimPing: PendingMentionPingService['claimPing'] = (i) => current().claimPing(i)
export const pruneOlderThanPings: PendingMentionPingService['pruneOlderThan'] = (c) => current().pruneOlderThan(c)
