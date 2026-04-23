import type { Tx } from '@server/common/port-types'
import type { WakeTrigger } from '@server/events'
import type { PendingApproval } from '../schema'
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

export function createPendingApprovalsService(deps: PendingApprovalsServiceDeps): PendingApprovalsService {
  const db = deps.db
  const scheduler = deps.scheduler ?? null

  async function insert(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval> {
    const { pendingApprovals } = await import('@modules/messaging/schema')
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
    const { eq } = await import('drizzle-orm')
    const { pendingApprovals } = await import('@modules/messaging/schema')
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
    const { pendingApprovals } = await import('@modules/messaging/schema')
    const { eq, and, desc } = await import('drizzle-orm')
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

  async function decide(id: string, input: DecideInput): Promise<DecideResult> {
    const { and, eq } = await import('drizzle-orm')
    const { pendingApprovals, conversations } = await import('@modules/messaging/schema')
    const handle = db as {
      select: () => {
        from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } }
      }
      update: (t: unknown) => {
        set: (v: unknown) => { where: (c: unknown) => { returning: () => Promise<unknown[]> } }
      }
    }

    const updated = (await handle
      .update(pendingApprovals)
      .set({
        status: input.decision,
        decidedAt: new Date(),
        decidedByUserId: input.decidedByUserId,
        decidedNote: input.note ?? null,
      })
      .where(and(eq(pendingApprovals.id, id), eq(pendingApprovals.status, 'pending')))
      .returning()) as PendingApproval[]
    const approval = updated[0]
    if (!approval) throw new ApprovalNotPendingError(id)

    const convRows = (await handle
      .select()
      .from(conversations)
      .where(eq(conversations.id, approval.conversationId))
      .limit(1)) as Array<{ assignee: string }>
    const conv = convRows[0]
    if (!conv) throw new ConversationMissingError(approval.conversationId)
    const agentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice(6) : null
    if (!agentId) throw new ApprovalAssigneeInvalidError(conv.assignee)

    const trigger: Extract<WakeTrigger, { trigger: 'approval_resumed' }> = {
      trigger: 'approval_resumed',
      conversationId: approval.conversationId,
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
    const { addNote } = await import('./notes')
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
}

function current(): PendingApprovalsService {
  if (!_currentPendingApprovalsService) {
    throw new Error('messaging/pending-approvals: service not installed — call installPendingApprovalsService()')
  }
  return _currentPendingApprovalsService
}

export async function insert(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval> {
  return current().insert(input, tx)
}
export async function get(id: string): Promise<PendingApproval> {
  return current().get(id)
}
export async function list(organizationId: string, opts?: { status?: string }): Promise<PendingApproval[]> {
  return current().list(organizationId, opts)
}
export async function decide(id: string, input: DecideInput): Promise<DecideResult> {
  return current().decide(id, input)
}
export async function persistRejectionNote(
  approval: PendingApproval,
  decidedByUserId: string,
  body: string,
): Promise<void> {
  return current().persistRejectionNote(approval, decidedByUserId, body)
}
