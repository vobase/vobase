import type { AgentEvent } from '@modules/agents/events'
import { conversations } from '@modules/messaging/schema'
import { appendJournalEvent } from '@modules/messaging/service/journal'
import type { ChangePayload } from '@vobase/core'
import { conflict, journalGetLatestTurnIndex as getLatestTurnIndex, notFound, validation } from '@vobase/core'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import type { RealtimeService } from '~/runtime'
import {
  type ChangedByKind,
  type ChangeHistoryRow,
  type ChangeProposalInboxItem,
  type ChangeProposalRow,
  type ChangeStatus,
  changeHistory,
  changeProposals,
} from '../schema'

// ─── Materializer registry ───────────────────────────────────────────────────

export interface MaterializeResult {
  resultId: string
  before: unknown
  after: unknown
}

export type Materializer = (proposal: ChangeProposalRow, tx: TxLike) => Promise<MaterializeResult>

export interface MaterializerRegistration {
  resourceModule: string
  resourceType: string
  /** When false, `insertProposal` writes status='auto_written' and fires the materializer in the same tx. */
  requiresApproval: boolean
  materialize: Materializer
}

const registry = new Map<string, MaterializerRegistration>()

export function registerChangeMaterializer(reg: MaterializerRegistration): void {
  registry.set(registryKey(reg.resourceModule, reg.resourceType), reg)
}

/** Test-only — clears the in-process registry between cases. */
export function __resetChangeRegistryForTests(): void {
  registry.clear()
}

function registryKey(m: string, t: string): string {
  return `${m}:${t}`
}

function getRegistration(resourceModule: string, resourceType: string): MaterializerRegistration {
  const reg = registry.get(registryKey(resourceModule, resourceType))
  if (!reg) {
    throw validation(
      { resourceModule, resourceType },
      `change-proposals: no materializer registered for ('${resourceModule}','${resourceType}')`,
    )
  }
  return reg
}

// Loose drizzle handle shape — keeps tests lightweight without dragging in
// the full ScopedDb generic and its drizzle expression types.
interface DrizzleHandle {
  insert: (t: unknown) => {
    values: (v: unknown) => {
      returning: () => Promise<Array<Record<string, unknown>>>
    }
  }
  update: (t: unknown) => {
    set: (v: unknown) => {
      where: (c: unknown) => Promise<unknown>
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
      orderBy: (col: unknown) => {
        limit: (n: number) => Promise<Array<Record<string, unknown>>>
      }
    }
  }
  execute: (q: unknown) => Promise<unknown>
  transaction: <T>(fn: (tx: DrizzleHandle) => Promise<T>) => Promise<T>
}

export type TxLike = DrizzleHandle

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Status is derived from the materializer registry's `requiresApproval` flag —
 * the input shape deliberately omits `status` so callers cannot bypass the
 * approval gate.
 */
export interface InsertProposalInput {
  organizationId: string
  resourceModule: string
  resourceType: string
  resourceId: string
  payload: ChangePayload
  changedBy: string
  changedByKind: ChangedByKind
  confidence?: number
  /** Free-prose problem statement written by the proposer. Rendered as the "Problem" panel on /changes. */
  rationale?: string
  /** Free-prose "what changes after approval" written by the proposer. Rendered as the "After approval" panel on /changes. */
  expectedOutcome?: string
  /** Non-null when the proposal originates from an agent wake — drives the journal-emission branch. */
  conversationId?: string | null
}

export interface RecordChangeInput {
  organizationId: string
  resourceModule: string
  resourceType: string
  resourceId: string
  payload: ChangePayload
  before: unknown
  after: unknown
  changedBy: string
  changedByKind: ChangedByKind
  appliedProposalId?: string | null
}

export interface DecideResult {
  id: string
  status: 'approved' | 'rejected'
  appliedHistoryId: string | null
}

// biome-ignore lint/suspicious/useAwait: contract requires async signature
async function runThreatScan(_payload: ChangePayload): Promise<{ ok: true } | { ok: false; reason: string }> {
  return { ok: true }
}

/**
 * Coerce a `changedBy` value to the canonical `agent:<id>` / `staff:<id>` form
 * the frontend `<Principal>` directory expects. Drive's CLI already prefixes
 * (`agent:${ctx.agentId}`); contacts' CLI passes a bare user id. We tolerate
 * both and normalize here so downstream consumers (DB, UI) see one shape.
 */
function normalizePrincipalToken(id: string, kind: ChangedByKind): string {
  if (id.includes(':')) return id
  return `${kind === 'agent' ? 'agent' : 'staff'}:${id}`
}

/** Narrow a payload to `markdown_patch` or throw — shared by markdown-only materializers. */
export function assertMarkdownPatch(payload: ChangePayload): Extract<ChangePayload, { kind: 'markdown_patch' }> {
  if (payload.kind !== 'markdown_patch') {
    throw validation({ kind: payload.kind }, `expected markdown_patch payload, got '${payload.kind}'`)
  }
  return payload
}

// ─── Service ─────────────────────────────────────────────────────────────────

export interface ChangeProposalsServiceDeps {
  db: unknown
  realtime?: RealtimeService | null
}

export interface ChangeProposalsService {
  insertProposal(input: InsertProposalInput): Promise<{ id: string; status: ChangeStatus }>
  decideChangeProposal(
    id: string,
    decision: 'approved' | 'rejected',
    decidedByUserId: string,
    note?: string,
  ): Promise<DecideResult>
  listInbox(organizationId: string, limit?: number): Promise<ChangeProposalInboxItem[]>
  recordChange(input: RecordChangeInput): Promise<{ id: string }>
  setRealtime(handle: RealtimeService | null): void
}

export function createChangeProposalsService(deps: ChangeProposalsServiceDeps): ChangeProposalsService {
  const db = deps.db as DrizzleHandle
  let realtime: RealtimeService | null = deps.realtime ?? null

  function fireNotify(
    p: Pick<ChangeProposalRow, 'id' | 'resourceModule' | 'resourceType' | 'resourceId' | 'conversationId'>,
    action: 'created' | 'auto_written' | 'approved' | 'rejected',
  ): void {
    if (!realtime) return
    try {
      realtime.notify({
        table: 'change_proposals',
        id: p.id,
        action,
        resourceModule: p.resourceModule,
        resourceType: p.resourceType,
        resourceId: p.resourceId,
        conversationId: p.conversationId,
      })
    } catch {
      // notify is best-effort — never fail the decide path on a NOTIFY error
    }
  }

  function buildProposalRow(input: InsertProposalInput, id: string, status: ChangeStatus): ChangeProposalRow {
    return {
      id,
      organizationId: input.organizationId,
      resourceModule: input.resourceModule,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.payload,
      status,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      expectedOutcome: input.expectedOutcome ?? null,
      conversationId: input.conversationId ?? null,
      proposedById: normalizePrincipalToken(input.changedBy, input.changedByKind),
      proposedByKind: input.changedByKind,
      decidedByUserId: null,
      decidedAt: null,
      decidedNote: null,
      appliedHistoryId: null,
      createdAt: new Date(),
    }
  }

  async function findPendingDuplicate(input: InsertProposalInput): Promise<ChangeProposalRow | null> {
    const rows = (await db
      .select()
      .from(changeProposals)
      .where(
        and(
          eq(changeProposals.organizationId, input.organizationId),
          eq(changeProposals.resourceModule, input.resourceModule),
          eq(changeProposals.resourceType, input.resourceType),
          eq(changeProposals.resourceId, input.resourceId),
          eq(changeProposals.status, 'pending'),
        ),
      )
      .limit(1)) as unknown as ChangeProposalRow[]
    return rows[0] ?? null
  }

  async function insertProposal(input: InsertProposalInput): Promise<{ id: string; status: ChangeStatus }> {
    const reg = getRegistration(input.resourceModule, input.resourceType)
    // Friendly conflict at the service layer: agents can be told "you already have a
    // pending proposal on this target" instead of bumping into the DB unique index.
    const dup = await findPendingDuplicate(input)
    if (dup) {
      throw conflict(
        `change-proposals: ${input.resourceModule}/${input.resourceType}/${input.resourceId} already has a pending proposal (id=${dup.id})`,
      )
    }

    const status: ChangeStatus = reg.requiresApproval ? 'pending' : 'auto_written'
    const id = nanoid(10)
    const proposal = buildProposalRow(input, id, status)

    if (reg.requiresApproval) {
      await db.insert(changeProposals).values(proposal).returning()
      fireNotify(proposal, 'created')
      return { id, status }
    }

    // requiresApproval=false — atomically insert + materialize + record history.
    await db.transaction(async (tx) => {
      await tx.insert(changeProposals).values(proposal).returning()
      const result = await reg.materialize(proposal, tx)
      const historyId = await writeHistoryRow(tx, {
        organizationId: input.organizationId,
        resourceModule: input.resourceModule,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        payload: input.payload,
        before: result.before,
        after: result.after,
        changedBy: input.changedBy,
        changedByKind: input.changedByKind,
        appliedProposalId: id,
      })
      await tx.update(changeProposals).set({ appliedHistoryId: historyId }).where(eq(changeProposals.id, id))
    })

    fireNotify(proposal, 'auto_written')
    return { id, status }
  }

  async function decideChangeProposal(
    id: string,
    decision: 'approved' | 'rejected',
    decidedByUserId: string,
    note?: string,
  ): Promise<DecideResult> {
    // Status guard runs against the same row read inside the rejection/approval
    // tx below. Threat-scan is async and intentionally outside the tx so a future
    // real scanner doesn't hold a row lock for its duration.
    const result = await db.transaction(async (tx) => {
      const proposal = await loadProposal(tx, id)
      if (!proposal) throw notFound(`change-proposals: not found: ${id}`)
      if (proposal.status !== 'pending') {
        throw conflict(`change-proposals: not pending (status=${proposal.status})`)
      }
      return proposal
    })

    if (decision === 'rejected') {
      await applyRejection(id, result, decidedByUserId, note ?? 'staff_rejected')
      fireNotify(result, 'rejected')
      return { id, status: 'rejected', appliedHistoryId: null }
    }

    const scan = await runThreatScan(result.payload)
    if (!scan.ok) {
      await applyRejection(id, result, decidedByUserId, 'threat_scan')
      fireNotify(result, 'rejected')
      return { id, status: 'rejected', appliedHistoryId: null }
    }

    const reg = getRegistration(result.resourceModule, result.resourceType)
    const historyId = await db.transaction(async (tx) => {
      const materialized = await reg.materialize(result, tx)
      const changedByKind: ChangedByKind = result.conversationId ? 'agent' : 'user'
      const hid = await writeHistoryRow(tx, {
        organizationId: result.organizationId,
        resourceModule: result.resourceModule,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        payload: result.payload,
        before: materialized.before,
        after: materialized.after,
        changedBy: decidedByUserId,
        changedByKind,
        appliedProposalId: id,
      })
      await tx
        .update(changeProposals)
        .set({
          status: 'approved',
          decidedByUserId,
          decidedAt: new Date(),
          decidedNote: note ?? null,
          appliedHistoryId: hid,
        })
        .where(eq(changeProposals.id, id))
      await emitJournalIfConversation(tx, result, {
        type: 'change_approved',
        proposalId: id,
        writeId: materialized.resultId,
      })
      return hid
    })

    fireNotify(result, 'approved')
    return { id, status: 'approved', appliedHistoryId: historyId }
  }

  async function applyRejection(
    id: string,
    proposal: ChangeProposalRow,
    decidedByUserId: string,
    reason: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(changeProposals)
        .set({
          status: 'rejected',
          decidedByUserId,
          decidedAt: new Date(),
          decidedNote: reason,
        })
        .where(eq(changeProposals.id, id))
      await emitJournalIfConversation(tx, proposal, { type: 'change_rejected', proposalId: id, reason })
    })
  }

  async function listInbox(organizationId: string, limit = 100): Promise<ChangeProposalInboxItem[]> {
    const rows = (await db
      .select()
      .from(changeProposals)
      .where(and(eq(changeProposals.organizationId, organizationId), eq(changeProposals.status, 'pending')))
      .orderBy(desc(changeProposals.createdAt))
      .limit(limit)) as unknown as ChangeProposalRow[]

    // Resolve conversationId → contactId in a single follow-up read so the UI
    // can render a clickable contact pill without a per-row round-trip.
    // Cross-pgSchema join would be cleaner but the loose DrizzleHandle type
    // here doesn't surface `.leftJoin()` — two reads is the cheaper escape.
    const conversationIds = Array.from(
      new Set(rows.map((r) => r.conversationId).filter((id): id is string => Boolean(id))),
    )
    const contactByConvId = new Map<string, string>()
    if (conversationIds.length > 0) {
      const convRows = (await db
        .select()
        .from(conversations)
        .where(inArray(conversations.id, conversationIds))) as Array<{ id: string; contactId: string }>
      for (const cv of convRows) contactByConvId.set(cv.id, cv.contactId)
    }

    return rows.map((row) => ({
      ...row,
      conversationContactId: row.conversationId ? (contactByConvId.get(row.conversationId) ?? null) : null,
    }))
  }

  return {
    insertProposal,
    decideChangeProposal,
    listInbox,
    async recordChange(input: RecordChangeInput): Promise<{ id: string }> {
      const id = await writeHistoryRow(db, input)
      return { id }
    },
    setRealtime(handle) {
      realtime = handle
    },
  }
}

// ─── Internal helpers (closure over schema; tx-aware) ────────────────────────

async function loadProposal(handle: DrizzleHandle, id: string): Promise<ChangeProposalRow | null> {
  const rows = (await handle
    .select()
    .from(changeProposals)
    .where(eq(changeProposals.id, id))
    .limit(1)) as unknown as ChangeProposalRow[]
  return rows[0] ?? null
}

async function writeHistoryRow(handle: DrizzleHandle, input: RecordChangeInput): Promise<string> {
  const id = nanoid(10)
  await handle
    .insert(changeHistory)
    .values({
      id,
      organizationId: input.organizationId,
      resourceModule: input.resourceModule,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.payload,
      before: input.before ?? null,
      after: input.after ?? null,
      changedBy: input.changedBy,
      changedByKind: input.changedByKind,
      appliedProposalId: input.appliedProposalId ?? null,
    })
    .returning()
  return id
}

type DecideJournalEvent =
  | { type: 'change_approved'; proposalId: string; writeId: string }
  | { type: 'change_rejected'; proposalId: string; reason: string }

async function emitJournalIfConversation(
  handle: DrizzleHandle,
  proposal: ChangeProposalRow,
  event: DecideJournalEvent,
): Promise<void> {
  if (!proposal.conversationId) return
  const turnIndex = await getLatestTurnIndex(proposal.conversationId, handle)
  const base = {
    ts: new Date(),
    wakeId: `change_decision:${event.proposalId}`,
    conversationId: proposal.conversationId,
    organizationId: proposal.organizationId,
    turnIndex,
  }

  const journalEvent =
    event.type === 'change_approved'
      ? { ...base, type: 'change_approved' as const, proposalId: event.proposalId, writeId: event.writeId }
      : { ...base, type: 'change_rejected' as const, proposalId: event.proposalId, reason: event.reason }

  await appendJournalEvent(
    {
      conversationId: proposal.conversationId,
      organizationId: proposal.organizationId,
      wakeId: base.wakeId,
      turnIndex,
      event: journalEvent as unknown as AgentEvent,
    },
    handle,
  )
}

// ─── Module-scoped install + port-shim free functions ────────────────────────

let _service: ChangeProposalsService | null = null

export function installChangeProposalsService(svc: ChangeProposalsService): void {
  _service = svc
}

export function __resetChangeProposalsServiceForTests(): void {
  _service = null
}

function current(): ChangeProposalsService {
  if (!_service) {
    throw new Error('changes/proposals: service not installed — call installChangeProposalsService() in module init')
  }
  return _service
}

export function insertProposal(input: InsertProposalInput): Promise<{ id: string; status: ChangeStatus }> {
  return current().insertProposal(input)
}

export function decideChangeProposal(
  id: string,
  decision: 'approved' | 'rejected',
  decidedByUserId: string,
  note?: string,
): Promise<DecideResult> {
  return current().decideChangeProposal(id, decision, decidedByUserId, note)
}

export function listInbox(organizationId: string, limit?: number): Promise<ChangeProposalInboxItem[]> {
  return current().listInbox(organizationId, limit)
}

/** Sanctioned write path into `change_history`. `check:shape` blocks any other path. */
export function recordChange(input: RecordChangeInput): Promise<{ id: string }> {
  return current().recordChange(input)
}

export type { ChangeHistoryRow, ChangeProposalRow }
