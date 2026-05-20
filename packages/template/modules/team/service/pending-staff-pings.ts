/**
 * TTL ledger for outbound staff pings on the notification-tier WhatsApp channel.
 *
 * Generalized in US-007 (Slice B.2) from the original `pending_mention_pings`
 * ledger to a multi-kind `pending_staff_pings` ledger. The `kind` column
 * discriminates `'mention'` (current) / `'approval'` / `'proposal'` (US-009).
 *
 * - Written by `team/service/staff-ping.ts` (kind='mention') after a
 *   successful WA send, carrying the send's `outboundWamid` when the provider
 *   returned one.
 * - Claimed by the inbound notifications handler when a staff WhatsApp reply
 *   arrives, via a two-rung ladder (`claimPing`):
 *     1. Exact match — if the inbound carries a `context.id` (the quoted-message
 *        wamid, present only when staff use WhatsApp's native reply gesture),
 *        soft-delete the ping whose `outboundWamid` equals it.
 *     2. Count-aware — otherwise, claim iff the staff member has exactly one
 *        live (claimed_at IS NULL) ping. Two or more is `ambiguous`; zero is
 *        `none`. Both fall through to operator-thread chat in the caller.
 *   Claims are now soft-deletes (`UPDATE … SET claimed_at = now(), claimed_wamid = $wamid`)
 *   rather than DELETE…RETURNING, so the dispatcher can post-hoc inspect what
 *   each ping was answered with. The logical contract (atomic, idempotent, a
 *   row cannot be claimed twice) is preserved — the WHERE clause filters on
 *   `claimed_at IS NULL`.
 *
 * TTL semantics: a ping older than `PING_TTL_MS` (30 minutes) is treated as
 * stale and ignored — the staff member's reply becomes operator-thread chat
 * instead. Read-time TTL filter is the primary cleanup; `pruneOlderThan` now
 * deletes only rows with `claimed_at < cutoff` (old claimed rows), leaving
 * live unclaimed rows intact for the TTL filter to discard at read-time.
 * The nightly prune cron (seeded for US-013 wiring) calls this with
 * `now() - interval '7 days'`.
 */

import { type PendingStaffPing, pendingStaffPings } from '@modules/team/schema'
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

/** 30-minute TTL. Pings older than this are treated as stale. */
export const PING_TTL_MS = 30 * 60 * 1000

export interface RecordPingInput {
  conversationId: string
  staffUserId: string
  organizationId: string
  askingAgentId: string
  originalNoteId: string
  /** Discriminator for multi-kind pings. */
  kind: 'mention' | 'approval' | 'proposal'
  /** Carries the approvalId / proposalId for non-mention kinds; null for 'mention'. */
  referenceId?: string | null
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
  /**
   * The inbound message's own wamid (messages[0].id). Stored in `claimed_wamid`
   * on the soft-delete row so the dispatcher can post-hoc inspect which reply
   * claimed each ping.
   */
  inboundWamid?: string | null
}

/**
 * Outcome of a `claimPing` call:
 * - `claimed`   — a single ping was atomically soft-deleted; route the reply as
 *                 an ask-staff-answer internal note that wakes `ping.askingAgentId`.
 * - `none`      — no live ping; the reply is a fresh staff-initiated message.
 * - `ambiguous` — the staff member has `liveCount` (≥2) live pings and the
 *                 inbound carried no exact wamid match, so we refuse to guess.
 */
export type ClaimPingResult =
  | { status: 'claimed'; ping: PendingStaffPing }
  | { status: 'none' }
  | { status: 'ambiguous'; liveCount: number }

export interface PendingStaffPingService {
  recordPing(input: RecordPingInput): Promise<void>
  /**
   * Atomically claim a ping for this (staff, org) tuple via the two-rung
   * ladder (see file header). Every successful claim is a soft-delete
   * (`UPDATE … SET claimed_at = now() WHERE claimed_at IS NULL`), so a row
   * can never be claimed twice and concurrent/redelivered inbounds are race-safe.
   */
  claimPing(input: ClaimPingInput): Promise<ClaimPingResult>
  /**
   * Delete rows with claimed_at < cutoff (old claimed rows only). Live
   * unclaimed rows are preserved — the read-time TTL filter handles them.
   * Returns count removed.
   */
  pruneOlderThan(cutoff: Date): Promise<number>
}

interface PingDeps {
  db: ScopedDb
}

/**
 * Raw row shape from the soft-delete UPDATE…RETURNING / the count-aware CTE.
 * Columns are nullable because the count-aware statement `LEFT JOIN`s the
 * updated row onto a single-row spine — when nothing was updated, every
 * payload column is null and only `live_count` is populated.
 */
interface RawPingRow extends Record<string, unknown> {
  id: string | null
  conversation_id: string | null
  staff_user_id: string | null
  organization_id: string | null
  asking_agent_id: string | null
  original_note_id: string | null
  outbound_wamid: string | null
  kind: string | null
  reference_id: string | null
  claimed_at: string | Date | null
  claimed_wamid: string | null
  created_at: string | Date | null
  live_count?: number | string | null
}

/**
 * A `RawPingRow` whose payload columns are populated — a real UPDATE…RETURNING
 * row, not the empty-spine row the count-aware CTE yields when nothing was
 * updated. `isClaimedRow` is the only way to obtain one.
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

const PING_COLUMNS = sql`id, conversation_id, staff_user_id, organization_id, asking_agent_id, original_note_id, outbound_wamid, kind, reference_id, claimed_at, claimed_wamid, created_at`

/** Normalise drizzle's `db.execute` return (postgres-js array vs `{ rows }`). */
function extractRows(result: unknown): RawPingRow[] {
  if (Array.isArray(result)) return result as RawPingRow[]
  return (result as { rows?: RawPingRow[] }).rows ?? []
}

/**
 * A populated `id` only ever comes back on a real updated row, and the table's
 * core payload columns are all `.notNull()` — so a present `id` implies the rest.
 */
function isClaimedRow(row: RawPingRow | undefined): row is ClaimedPingRow {
  return typeof row?.id === 'string'
}

function rowToPing(row: ClaimedPingRow): PendingStaffPing {
  return {
    conversationId: row.conversation_id,
    staffUserId: row.staff_user_id,
    organizationId: row.organization_id,
    askingAgentId: row.asking_agent_id,
    originalNoteId: row.original_note_id,
    outboundWamid: row.outbound_wamid,
    kind: row.kind ?? 'mention',
    referenceId: row.reference_id ?? null,
    claimedAt: row.claimed_at ? (row.claimed_at instanceof Date ? row.claimed_at : new Date(row.claimed_at)) : null,
    claimedWamid: row.claimed_wamid ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at as string),
  }
}

export function createPendingStaffPingService(deps: PingDeps): PendingStaffPingService {
  const db = deps.db

  async function recordPing(input: RecordPingInput): Promise<void> {
    await db
      .insert(pendingStaffPings)
      .values({
        conversationId: input.conversationId,
        staffUserId: input.staffUserId,
        organizationId: input.organizationId,
        askingAgentId: input.askingAgentId,
        originalNoteId: input.originalNoteId,
        outboundWamid: input.outboundWamid ?? null,
        kind: input.kind,
        referenceId: input.referenceId ?? null,
      })
      .onConflictDoUpdate({
        target: [pendingStaffPings.organizationId, pendingStaffPings.conversationId, pendingStaffPings.staffUserId],
        set: {
          askingAgentId: input.askingAgentId,
          originalNoteId: input.originalNoteId,
          organizationId: input.organizationId,
          outboundWamid: input.outboundWamid ?? null,
          kind: input.kind,
          referenceId: input.referenceId ?? null,
          // Reset claim state on upsert — a re-ping supersedes the old claimed row.
          claimedAt: null,
          claimedWamid: null,
          createdAt: new Date(),
        },
      })
  }

  // postgres-js does not auto-bind Date in raw `sql\`…${date}…\``; the cutoff is
  // passed as an ISO string and cast to timestamptz at the DB boundary.
  function ttlCutoffIso(): string {
    return new Date(Date.now() - PING_TTL_MS).toISOString()
  }

  /**
   * Rung 1 — exact wamid match. No `claimed_at IS NULL` filter: a quote-reply's
   * `context.id` unambiguously identifies the conversation, so repeat replies
   * to the same notification still route back to it.
   */
  async function claimByWamid(input: ClaimPingInput, wamid: string): Promise<PendingStaffPing | null> {
    const target = db
      .select({ id: pendingStaffPings.id })
      .from(pendingStaffPings)
      .where(
        and(
          eq(pendingStaffPings.staffUserId, input.staffUserId),
          eq(pendingStaffPings.organizationId, input.organizationId),
          eq(pendingStaffPings.outboundWamid, wamid),
          gt(pendingStaffPings.createdAt, new Date(Date.now() - PING_TTL_MS)),
        ),
      )
      .orderBy(desc(pendingStaffPings.createdAt))
      .limit(1)
    const [row] = await db
      .update(pendingStaffPings)
      .set({ claimedAt: new Date(), claimedWamid: input.inboundWamid ?? null })
      .where(inArray(pendingStaffPings.id, target))
      .returning()
    if (!row) return null
    const { id: _id, ...ping } = row
    return ping
  }

  /**
   * Rung 2 — count-aware. One atomic statement: the `live` CTE is the shared
   * snapshot (claimed_at IS NULL + TTL filter), `updated` only fires when that
   * snapshot holds exactly one row, and the `LEFT JOIN` onto a single-row spine
   * guarantees one result row even when nothing was updated — so the caller
   * always gets `live_count` back.
   */
  async function claimSoleLivePing(input: ClaimPingInput): Promise<ClaimPingResult> {
    const inboundWamid = input.inboundWamid ?? null
    const result = await db.execute<RawPingRow>(sql`
      WITH live AS (
        SELECT id FROM ${pendingStaffPings}
        WHERE staff_user_id = ${input.staffUserId}
          AND organization_id = ${input.organizationId}
          AND claimed_at IS NULL
          AND created_at > ${ttlCutoffIso()}::timestamptz
      ),
      updated AS (
        UPDATE ${pendingStaffPings}
        SET claimed_at = now(), claimed_wamid = ${inboundWamid}
        WHERE id IN (SELECT id FROM live)
          AND (SELECT count(*) FROM live) = 1
        RETURNING ${PING_COLUMNS}
      )
      SELECT (SELECT count(*)::int FROM live) AS live_count,
             u.id, u.conversation_id, u.staff_user_id, u.organization_id,
             u.asking_agent_id, u.original_note_id, u.outbound_wamid,
             u.kind, u.reference_id, u.claimed_at, u.claimed_wamid, u.created_at
      FROM (SELECT 1) AS _spine
      LEFT JOIN updated u ON true
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
    // Only delete claimed rows older than the cutoff — live unclaimed rows are
    // handled by the read-time TTL filter (`created_at > now() - 30min`).
    // The nightly prune cron (US-013 dispatcher wiring) calls this with
    // cutoff = now() - 7 days to garbage-collect claimed rows from the ledger.
    const result = await db.execute<RawPingRow>(sql`
      DELETE FROM ${pendingStaffPings}
      WHERE claimed_at < ${cutoffIso}::timestamptz
      RETURNING id
    `)
    return extractRows(result).length
  }

  return { recordPing, claimPing, pruneOlderThan }
}

let _current: PendingStaffPingService | null = null
export function installPendingStaffPingService(svc: PendingStaffPingService): void {
  _current = svc
}
export function __resetPendingStaffPingServiceForTests(): void {
  _current = null
}

function current(): PendingStaffPingService {
  if (!_current) {
    throw new Error(
      'team/pending-staff-pings: service not installed — call installPendingStaffPingService() in module init',
    )
  }
  return _current
}

export const recordPing: PendingStaffPingService['recordPing'] = (i) => current().recordPing(i)
export const claimPing: PendingStaffPingService['claimPing'] = (i) => current().claimPing(i)
export const pruneOlderThanPings: PendingStaffPingService['pruneOlderThan'] = (c) => current().pruneOlderThan(c)
