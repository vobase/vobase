/**
 * TTL ledger for outbound `@-mention` pings on the notification-tier WhatsApp
 * channel.
 *
 * - Written by `team/service/mention-notify.ts` after a successful WA send.
 * - Read (atomic `DELETE … RETURNING`) by the inbound notifications handler
 *   when a staff WhatsApp reply arrives. The DELETE-RETURNING pattern means
 *   the same row can never be claimed twice; concurrent inbounds for the
 *   same staff are race-safe.
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
}

export interface ClaimPingInput {
  staffUserId: string
  /**
   * Scopes the claim to the calling org — prevents cross-tenant collision when
   * the same staff phone is linked to multiple tenants on the same platform.
   */
  organizationId: string
}

export interface PendingMentionPingService {
  recordPing(input: RecordPingInput): Promise<void>
  /**
   * Atomic DELETE … RETURNING the freshest unexpired ping for this
   * (staff, org) tuple. Returns null when no live ping exists.
   */
  claimPing(input: ClaimPingInput): Promise<PendingMentionPing | null>
  /** Delete rows older than the cutoff. Returns count removed. */
  pruneOlderThan(cutoff: Date): Promise<number>
}

interface PingDeps {
  db: ScopedDb
}

interface PingRow extends Record<string, unknown> {
  id: string
  conversation_id: string
  staff_user_id: string
  organization_id: string
  asking_agent_id: string
  original_note_id: string
  created_at: string | Date
}

function rowToPing(row: PingRow): PendingMentionPing {
  return {
    conversationId: row.conversation_id,
    staffUserId: row.staff_user_id,
    organizationId: row.organization_id,
    askingAgentId: row.asking_agent_id,
    originalNoteId: row.original_note_id,
    createdAt: typeof row.created_at === 'string' ? new Date(row.created_at) : row.created_at,
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
      })
      .onConflictDoUpdate({
        target: [pendingMentionPings.conversationId, pendingMentionPings.staffUserId],
        set: {
          askingAgentId: input.askingAgentId,
          originalNoteId: input.originalNoteId,
          organizationId: input.organizationId,
          createdAt: new Date(),
        },
      })
  }

  async function claimPing(input: ClaimPingInput): Promise<PendingMentionPing | null> {
    // Atomic delete the freshest unexpired row for the (staff, org) tuple.
    // The CTE picks the one row to delete; the DELETE returns its columns.
    // postgres-js does not auto-bind Date in raw `sql\`…${date}…\``; pass an
    // ISO string and cast to timestamptz at the DB boundary.
    const ttlCutoffIso = new Date(Date.now() - PING_TTL_MS).toISOString()
    const result = await db.execute<PingRow>(sql`
      DELETE FROM ${pendingMentionPings}
      WHERE id = (
        SELECT id FROM ${pendingMentionPings}
        WHERE staff_user_id = ${input.staffUserId}
          AND organization_id = ${input.organizationId}
          AND created_at > ${ttlCutoffIso}::timestamptz
        ORDER BY created_at DESC
        LIMIT 1
      )
      RETURNING id, conversation_id, staff_user_id, organization_id, asking_agent_id, original_note_id, created_at
    `)
    const rows = (Array.isArray(result) ? result : ((result as { rows?: PingRow[] }).rows ?? [])) as PingRow[]
    return rows[0] ? rowToPing(rows[0]) : null
  }

  async function pruneOlderThan(cutoff: Date): Promise<number> {
    const cutoffIso = cutoff.toISOString()
    const result = await db.execute(sql`
      DELETE FROM ${pendingMentionPings}
      WHERE created_at < ${cutoffIso}::timestamptz
      RETURNING id
    `)
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as unknown[]
    return rows.length
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
