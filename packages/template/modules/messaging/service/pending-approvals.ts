import { emit } from '@modules/automations/service/events'
import { conversations, pendingApprovals } from '@modules/messaging/schema'
import { and, desc, eq } from 'drizzle-orm'

import type { Tx } from '~/runtime'
import type { WakeTrigger } from '~/wake/events'
import type { PendingApproval } from '../schema'
import { addNote } from './notes'
import type { InsertPendingApprovalInput } from './types'

export class ApprovalNotPendingError extends Error {
  readonly code = 'APPROVAL_NOT_PENDING'
  constructor(approvalId: string) {
    super(`pending_approvals: not pending or missing: ${approvalId}`)
  }
}

export class ConversationMissingError extends Error {
  readonly code = 'CONVERSATION_MISSING'
  constructor(conversationId: string) {
    super(`pending_approvals.decide: conversation not found: ${conversationId}`)
  }
}

export class ApprovalAssigneeInvalidError extends Error {
  readonly code = 'APPROVAL_ASSIGNEE_INVALID'
  constructor(assignee: string) {
    super(`pending_approvals.decide: conversation assignee has no agent: ${assignee}`)
  }
}

/** Narrow port binding — avoids pulling the agents module's concrete scheduler class. */
export interface ApprovalScheduler {
  enqueue(trigger: WakeTrigger, opts: { agentId: string; organizationId: string }): Promise<unknown>
}

export interface DecideInput {
  decision: 'approved' | 'rejected'
  decidedByUserId: string
  note?: string
}

export interface DecideResult {
  approval: PendingApproval
  trigger: Extract<WakeTrigger, { trigger: 'approval_resumed' }>
  agentId: string
  enqueued: boolean
}

export interface PendingApprovalsService {
  insert(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval>
  get(id: string): Promise<PendingApproval>
  list(organizationId: string, opts?: { status?: string }): Promise<PendingApproval[]>
  decide(id: string, input: DecideInput): Promise<DecideResult>
  persistRejectionNote(approval: PendingApproval, decidedByUserId: string, body: string): Promise<void>
}

export interface PendingApprovalsServiceDeps {
  db: unknown
  scheduler?: ApprovalScheduler | null
}

/**
 * Module-level db handle published by `createPendingApprovalsService`. Read by
 * the two agent-tool boundaries (`draft-email-to-review.ts`,
 * `propose-outreach.ts`) so they can wrap `insert + emit('approval_filed', …)`
 * in a single `db.transaction(...)` — keeping the emit at the tool boundary
 * (where `ctx.agentId` is in scope) per US-008 / Slice B.3.
 *
 * Exposed as a getter, not the raw db, so test-installs (and the dev-mode
 * reset hook) can re-bind without dangling references.
 */
let _approvalsTxDb: { transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> } | null = null

export function getPendingApprovalsTxDb(): { transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> } {
  if (!_approvalsTxDb) {
    throw new Error(
      'messaging/pending-approvals: tx-db not installed — call createPendingApprovalsService() in module init',
    )
  }
  return _approvalsTxDb
}

export function createPendingApprovalsService(deps: PendingApprovalsServiceDeps): PendingApprovalsService {
  const db = deps.db
  _approvalsTxDb = db as { transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }
  const scheduler = deps.scheduler ?? null

  async function insert(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval> {
    const runner = (tx as { insert: Function }) ?? (db as { insert: Function })
    const rows = await runner
      .insert(pendingApprovals)
      .values({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        conversationEventId: input.conversationEventId,
        toolName: input.toolName,
        toolArgs: input.toolArgs as Record<string, unknown>,
        agentSnapshot: input.agentSnapshot as Record<string, unknown>,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('messaging/pending-approvals.insert: insert returned no rows')
    return row as PendingApproval
  }

  async function get(id: string): Promise<PendingApproval> {
    const rows = (await (
      db as {
        select: () => {
          from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } }
        }
      }
    )
      .select()
      .from(pendingApprovals)
      .where(eq(pendingApprovals.id, id))
      .limit(1)) as unknown[]
    const row = rows[0] as PendingApproval | undefined
    if (!row) throw new Error(`pending_approvals: not found: ${id}`)
    return row
  }

  async function list(organizationId: string, opts?: { status?: string }): Promise<PendingApproval[]> {
    const whereClause = opts?.status
      ? and(eq(pendingApprovals.organizationId, organizationId), eq(pendingApprovals.status, opts.status))
      : eq(pendingApprovals.organizationId, organizationId)

    const rows = (await (db as { select: Function })
      .select()
      .from(pendingApprovals)
      .where(whereClause)
      .orderBy(desc(pendingApprovals.createdAt))
      .limit(50)) as unknown[]
    return rows as PendingApproval[]
  }

  /**
   * Decide a pending approval. Wrapped in `db.transaction(...)` as of US-008
   * (Slice B.3) so the status update + `approval_decided` event emit land in
   * the same Postgres tx — rollback ⇒ event vanishes. Concurrency improvement
   * over the pre-US-008 shape: a second concurrent `decide()` for the same id
   * now sees `ApprovalNotPendingError` deterministically (the partial-pending
   * filter inside the update plus the tx means the second update returns
   * zero rows under serializable contention).
   *
   * The scheduler.enqueue(...) call deliberately stays OUTSIDE the tx — pg-boss
   * uses its own connection pool, and a wake-resume event is not corruption-
   * sensitive (worst case the wake fires after the tx commits, which is the
   * intent anyway).
   */
  async function decide(id: string, input: DecideInput): Promise<DecideResult> {
    const txDb = db as { transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }

    const { approval, agentId } = await txDb.transaction(async (txUntyped) => {
      const tx = txUntyped as {
        select: () => {
          from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } }
        }
        update: (t: unknown) => {
          set: (v: unknown) => { where: (c: unknown) => { returning: () => Promise<unknown[]> } }
        }
      }

      const updated = (await tx
        .update(pendingApprovals)
        .set({
          status: input.decision,
          decidedAt: new Date(),
          decidedByUserId: input.decidedByUserId,
          decidedNote: input.note ?? null,
        })
        .where(and(eq(pendingApprovals.id, id), eq(pendingApprovals.status, 'pending')))
        .returning()) as PendingApproval[]
      const approvalRow = updated[0]
      if (!approvalRow) throw new ApprovalNotPendingError(id)

      // Outreach approvals (no conversation yet) take a different path —
      // the review UI handles create-or-resume itself. The conversation-resume
      // wake trigger only applies to conversation-bound approvals.
      if (!approvalRow.conversationId) {
        throw new Error(
          'messaging/pending-approvals.decide: outreach approvals must be resolved via the outreach review UI',
        )
      }

      const convRows = (await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, approvalRow.conversationId))
        .limit(1)) as Array<{ assignee: string }>
      const convRow = convRows[0]
      if (!convRow) throw new ConversationMissingError(approvalRow.conversationId)
      const aid = convRow.assignee.startsWith('agent:') ? convRow.assignee.slice(6) : null
      if (!aid) throw new ApprovalAssigneeInvalidError(convRow.assignee)

      // `filedByAgentId` is read from the denormalized `agentSnapshot` jsonb
      // (set at insert-time by the agent tool: `{ agentId, wakeId, turnIndex }`).
      // Routing target for the `approval_decided` standalone wake (Slice B.4
      // dispatcher reads this off the payload).
      const snapshot = (approvalRow.agentSnapshot ?? null) as { agentId?: string } | null
      const filedBy = snapshot?.agentId ?? aid

      // Pre-render `decidedByLabel` from the bare user id rather than joining
      // auth.user — keeps the decide path off the auth round-trip per
      // US-008 latency budget. US-014 will swap to the principal directory.
      const decidedByLabel = `staff ${input.decidedByUserId.slice(0, 8)}`

      await emit(
        'approval_decided',
        {
          conversationId: approvalRow.conversationId,
          organizationId: approvalRow.organizationId,
          approvalId: approvalRow.id,
          decision: input.decision === 'approved' ? 'approve' : 'deny',
          decidedByUserId: input.decidedByUserId,
          decidedByLabel,
          filedByAgentId: filedBy,
          ...(input.note ? { note: input.note } : {}),
        },
        { tx: tx as Tx },
      )

      return { approval: approvalRow, agentId: aid }
    })

    const trigger: Extract<WakeTrigger, { trigger: 'approval_resumed' }> = {
      trigger: 'approval_resumed',
      conversationId: approval.conversationId as string,
      approvalId: approval.id,
      decision: input.decision,
      note: input.note,
    }

    let enqueued = false
    if (scheduler) {
      await scheduler.enqueue(trigger, { agentId, organizationId: approval.organizationId })
      enqueued = true
    }

    return { approval, trigger, agentId, enqueued }
  }

  async function persistRejectionNote(approval: PendingApproval, decidedByUserId: string, body: string): Promise<void> {
    if (!approval.conversationId) return // outreach rejections have no conversation to annotate
    await addNote({
      organizationId: approval.organizationId,
      conversationId: approval.conversationId,
      author: { kind: 'staff', id: decidedByUserId },
      body: `Approval rejected: ${body}`,
    })
  }

  return { insert, get, list, decide, persistRejectionNote }
}

let _currentPendingApprovalsService: PendingApprovalsService | null = null

export function installPendingApprovalsService(svc: PendingApprovalsService): void {
  _currentPendingApprovalsService = svc
}

export function __resetPendingApprovalsServiceForTests(): void {
  _currentPendingApprovalsService = null
  _approvalsTxDb = null
}

/** Test-only: install a stub tx-db without going through createPendingApprovalsService. */
export function __installPendingApprovalsTxDbForTests(stub: {
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>
}): void {
  _approvalsTxDb = stub
}

function current(): PendingApprovalsService {
  if (!_currentPendingApprovalsService) {
    throw new Error('messaging/pending-approvals: service not installed — call installPendingApprovalsService()')
  }
  return _currentPendingApprovalsService
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function insert(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval> {
  return current().insert(input, tx)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function get(id: string): Promise<PendingApproval> {
  return current().get(id)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function list(organizationId: string, opts?: { status?: string }): Promise<PendingApproval[]> {
  return current().list(organizationId, opts)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function decide(id: string, input: DecideInput): Promise<DecideResult> {
  return current().decide(id, input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function persistRejectionNote(
  approval: PendingApproval,
  decidedByUserId: string,
  body: string,
): Promise<void> {
  return current().persistRejectionNote(approval, decidedByUserId, body)
}
