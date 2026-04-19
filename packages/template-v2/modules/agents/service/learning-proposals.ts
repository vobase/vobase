/**
 * Learning proposals — insert + decide for `agents.learning_proposals`.
 *
 * Scope routing: `contact` / `agent_memory` are auto-written by the observer;
 * `agent_skill` / `drive_doc` are pending until `decideProposal` runs the
 * threat-scan, materialises the approved scope, journals the decision, and
 * fires a pg_notify invalidate.
 */

import { nanoid } from 'nanoid'

let _db: unknown = null
let _notifier: NotifyFn | null = null

/**
 * Fired after a decision commits. Production wires this to pg_notify on the
 * shared `vobase_sse` channel with `{table: 'learning_proposals', id, action}`
 * so `use-realtime-invalidation.ts` invalidates the staff UI.
 */
export type NotifyFn = (channel: string, payload: string) => Promise<void> | void

export function setDb(db: unknown): void {
  _db = db
}

export function setNotifier(fn: NotifyFn | null): void {
  _notifier = fn
}

function requireDb() {
  if (!_db) throw new Error('agents/learning-proposals: db not initialised — call setDb() in module init')
  return _db as DrizzleHandle
}

export type ProposalScope = 'contact' | 'agent_memory' | 'agent_skill' | 'drive_doc'
export type ProposalAction = 'upsert' | 'create' | 'patch'
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'auto_written'

export interface InsertProposalInput {
  tenantId: string
  conversationId: string
  scope: ProposalScope
  action: ProposalAction
  target: string
  body?: string
  rationale?: string
  confidence?: number
  status?: ProposalStatus
}

export interface ProposalRow {
  id: string
  tenantId: string
  conversationId: string
  scope: ProposalScope
  action: ProposalAction
  target: string
  body: string | null
  rationale: string | null
  confidence: number | null
  status: ProposalStatus
  decidedByUserId: string | null
  decidedAt: Date | null
  decidedNote: string | null
  approvedWriteId: string | null
  createdAt: Date
}

interface DrizzleHandle {
  insert: (t: unknown) => {
    values: (v: unknown) => {
      returning: () => Promise<Array<Record<string, unknown>>>
    }
  }
  update: (t: unknown) => {
    set: (v: unknown) => {
      where: (c: unknown) => {
        returning: () => Promise<Array<Record<string, unknown>>>
      } & Promise<void>
    }
  }
  select: (cols?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => {
        limit: (n: number) => Promise<Array<Record<string, unknown>>>
        orderBy: (col: unknown) => {
          limit: (n: number) => Promise<Array<Record<string, unknown>>>
        } & Promise<Array<Record<string, unknown>>>
      } & Promise<Array<Record<string, unknown>>>
    }
  }
  execute: (sql: unknown) => Promise<unknown>
  transaction: <T>(fn: (tx: DrizzleHandle) => Promise<T>) => Promise<T>
}

export async function insertProposal(input: InsertProposalInput): Promise<{ id: string }> {
  const { learningProposals } = await import('@modules/agents/schema')
  const db = requireDb()
  const id = nanoid(10)
  const status: ProposalStatus = input.status ?? (needsApproval(input.scope) ? 'pending' : 'auto_written')

  await db
    .insert(learningProposals)
    .values({
      id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      scope: input.scope,
      action: input.action,
      target: input.target,
      body: input.body ?? null,
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
      status,
    })
    .returning()

  return { id }
}

export interface DecideResult {
  proposalId: string
  status: Extract<ProposalStatus, 'approved' | 'rejected'>
  writeId: string | null
  /** Reason populated when the threat-scan blocks an approval. */
  threatScanReport?: unknown
}

export async function decideProposal(
  id: string,
  decision: 'approved' | 'rejected',
  decidedByUserId: string,
  note?: string,
): Promise<DecideResult> {
  const { learningProposals } = await import('@modules/agents/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  const rows = (await db
    .select()
    .from(learningProposals)
    .where(eq(learningProposals.id, id))
    .limit(1)) as unknown as ProposalRow[]
  const proposal = rows[0]
  if (!proposal) throw new Error(`learning-proposals.decide: not found: ${id}`)
  if (proposal.status !== 'pending') {
    throw new Error(`learning-proposals.decide: not pending (status=${proposal.status})`)
  }

  if (decision === 'rejected') {
    await db.transaction(async (tx) => {
      await tx
        .update(learningProposals)
        .set({ status: 'rejected', decidedByUserId, decidedAt: new Date(), decidedNote: note ?? null })
        .where(eq(learningProposals.id, id))
      await emitJournalEvent(tx, proposal, {
        type: 'learning_rejected',
        proposalId: id,
        reason: note ?? 'staff_rejected',
      })
    })
    await notifyInvalidate('learnings:refresh', { proposalId: id, status: 'rejected' })
    return { proposalId: id, status: 'rejected', writeId: null }
  }

  const scanResult = await runThreatScan(proposal.body ?? '')
  if (!scanResult.ok) {
    await db.transaction(async (tx) => {
      await tx
        .update(learningProposals)
        .set({ status: 'rejected', decidedByUserId, decidedAt: new Date(), decidedNote: note ?? 'threat_scan' })
        .where(eq(learningProposals.id, id))
      await emitJournalEvent(tx, proposal, { type: 'learning_rejected', proposalId: id, reason: 'threat_scan' })
    })
    await notifyInvalidate('learnings:refresh', { proposalId: id, status: 'rejected' })
    return { proposalId: id, status: 'rejected', writeId: null, threatScanReport: scanResult }
  }

  const writeId = await db.transaction(async (tx) => {
    const wid = await writeApprovedScope(tx, proposal)
    await tx
      .update(learningProposals)
      .set({
        status: 'approved',
        decidedByUserId,
        decidedAt: new Date(),
        decidedNote: note ?? null,
        approvedWriteId: wid,
      })
      .where(eq(learningProposals.id, id))
    await emitJournalEvent(tx, proposal, { type: 'learning_approved', proposalId: id, writeId: wid })
    return wid
  })
  await notifyInvalidate(invalidateChannelFor(proposal.scope), { proposalId: id, writeId, scope: proposal.scope })

  return { proposalId: id, status: 'approved', writeId }
}

export async function listRecent(tenantId: string, status?: ProposalStatus, limit = 50): Promise<ProposalRow[]> {
  const { learningProposals } = await import('@modules/agents/schema')
  const { and, desc, eq } = await import('drizzle-orm')
  const db = requireDb()

  const where = status
    ? and(eq(learningProposals.tenantId, tenantId), eq(learningProposals.status, status))
    : eq(learningProposals.tenantId, tenantId)

  const rows = (await db
    .select()
    .from(learningProposals)
    .where(where)
    .orderBy(desc(learningProposals.createdAt))
    .limit(limit)) as unknown as ProposalRow[]
  return rows
}

function needsApproval(scope: ProposalScope): boolean {
  return scope === 'agent_skill' || scope === 'drive_doc'
}

function invalidateChannelFor(scope: ProposalScope): string {
  if (scope === 'agent_skill') return 'skills:invalidate'
  if (scope === 'drive_doc') return 'drive:invalidate'
  return 'learnings:refresh'
}

async function runThreatScan(_body: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Stub scanner — real patterns land with the moderation mutator work;
  // `server/contracts/threat-scan.ts` holds the signature every scanner honours.
  return { ok: true }
}

async function writeApprovedScope(db: DrizzleHandle, proposal: ProposalRow): Promise<string> {
  if (proposal.scope === 'agent_skill') {
    const { learnedSkills, conversationEvents } = await import('@modules/agents/schema')
    const { desc, eq, and } = await import('drizzle-orm')
    const agentRows = (await db
      .select({ payload: conversationEvents.payload, toolCalls: conversationEvents.toolCalls })
      .from(conversationEvents)
      .where(
        and(eq(conversationEvents.conversationId, proposal.conversationId), eq(conversationEvents.type, 'agent_start')),
      )
      .orderBy(desc(conversationEvents.ts))
      .limit(1)) as Array<{ payload: unknown; toolCalls: unknown }>
    const agentId = extractAgentIdFromStart(agentRows[0])

    const skillId = nanoid(10)
    await db
      .insert(learnedSkills)
      .values({
        id: skillId,
        tenantId: proposal.tenantId,
        agentId,
        name: proposal.target,
        description: proposal.rationale ?? proposal.target,
        body: proposal.body ?? '',
        parentProposalId: proposal.id,
      })
      .returning()
    return skillId
  }

  if (proposal.scope === 'drive_doc') {
    const writeId = `drive:${proposal.target}`
    return writeId
  }

  return `noop:${proposal.id}`
}

function extractAgentIdFromStart(row: { payload: unknown; toolCalls: unknown } | undefined): string | null {
  if (!row) return null
  const payload = (row.payload ?? row.toolCalls) as Record<string, unknown> | null
  if (!payload) return null
  const agentId = payload.agentId
  return typeof agentId === 'string' ? agentId : null
}

async function emitJournalEvent(
  db: DrizzleHandle,
  proposal: ProposalRow,
  event: {
    type: 'learning_approved' | 'learning_rejected'
    proposalId: string
    reason?: string
    writeId?: string
  },
): Promise<void> {
  const { conversationEvents } = await import('@modules/agents/schema')
  const { getLatestTurnIndex } = await import('./journal')

  const turnIndex = await getLatestTurnIndex(proposal.conversationId, db)

  const payload: Record<string, unknown> = { proposalId: event.proposalId }
  if (event.reason) payload.reason = event.reason
  if (event.writeId) payload.writeId = event.writeId

  await db.insert(conversationEvents).values({
    conversationId: proposal.conversationId,
    tenantId: proposal.tenantId,
    turnIndex,
    type: event.type,
    payload,
  })
}

async function notifyInvalidate(channel: string, payload: Record<string, unknown>): Promise<void> {
  if (!_notifier) return
  try {
    await _notifier(channel, JSON.stringify(payload))
  } catch {
    // notifications are best-effort — swallow so decide() never fails on NOTIFY
  }
}

/**
 * Build a `NotifyFn` that bridges the service's named channels
 * (`learnings:refresh` / `skills:invalidate` / `drive:invalidate`) into a
 * single `vobase_sse` pg_notify with the `{table, id, action}` payload that
 * `use-realtime-invalidation.ts` consumes. Call from module init and server
 * bootstrap — each wires its own drizzle handle.
 */
type ExecHandle = { execute: (query: never) => Promise<unknown> }

export function createLearningNotifier(db: unknown): NotifyFn {
  const handle = db as ExecHandle
  return async (channel, payload) => {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    const ssePayload = JSON.stringify({
      table: 'learning_proposals',
      id: parsed.proposalId ?? parsed.id,
      action: channel,
      ...parsed,
    })
    const { sql } = await import('drizzle-orm')
    await handle.execute(sql`SELECT pg_notify('vobase_sse', ${ssePayload})` as never)
  }
}
