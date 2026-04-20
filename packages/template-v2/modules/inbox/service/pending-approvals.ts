import type { PendingApproval } from '@server/contracts/domain-types'
import type { WakeTrigger } from '@server/contracts/event'
import type { InsertPendingApprovalInput, Tx } from '@server/contracts/inbox-port'

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

let _db: unknown = null
let _scheduler: ApprovalScheduler | null = null

/** Narrow port binding — avoids pulling the agents module's concrete scheduler class. */
export interface ApprovalScheduler {
  enqueue(trigger: WakeTrigger, opts: { agentId: string; organizationId: string }): Promise<unknown>
}

export function setDb(db: unknown): void {
  _db = db
}

export function setScheduler(scheduler: ApprovalScheduler): void {
  _scheduler = scheduler
}

function requireDb(): unknown {
  if (!_db) throw new Error('inbox/pending-approvals: db not initialised — call setDb() in module init')
  return _db
}

export async function insert(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval> {
  const { pendingApprovals } = await import('@modules/inbox/schema')
  const db = requireDb() as { insert: Function }
  const runner = (tx as typeof db) ?? db

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
  if (!row) throw new Error('inbox/pending-approvals.insert: insert returned no rows')
  return row as PendingApproval
}

export async function get(id: string): Promise<PendingApproval> {
  const { eq } = await import('drizzle-orm')
  const { pendingApprovals } = await import('@modules/inbox/schema')
  const db = requireDb() as {
    select: () => {
      from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } }
    }
  }
  const rows = (await db.select().from(pendingApprovals).where(eq(pendingApprovals.id, id)).limit(1)) as unknown[]
  const row = rows[0] as PendingApproval | undefined
  if (!row) throw new Error(`pending_approvals: not found: ${id}`)
  return row
}

export interface DecideInput {
  decision: 'approved' | 'rejected'
  decidedByUserId: string
  note?: string
}

export interface DecideResult {
  approval: PendingApproval
  trigger: Extract<WakeTrigger, { trigger: 'approval_resumed' }>
  /** Resolved agent id extracted from the blocked wake's snapshot. */
  agentId: string
  enqueued: boolean
}

export async function list(organizationId: string, opts?: { status?: string }): Promise<PendingApproval[]> {
  const { pendingApprovals } = await import('@modules/inbox/schema')
  const { eq, and, desc } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }

  const whereClause = opts?.status
    ? and(eq(pendingApprovals.organizationId, organizationId), eq(pendingApprovals.status, opts.status))
    : eq(pendingApprovals.organizationId, organizationId)

  const rows = (await db
    .select()
    .from(pendingApprovals)
    .where(whereClause)
    .orderBy(desc(pendingApprovals.createdAt))
    .limit(50)) as unknown[]

  return rows as PendingApproval[]
}

export async function decide(id: string, input: DecideInput): Promise<DecideResult> {
  const { and, eq } = await import('drizzle-orm')
  const { pendingApprovals, conversations } = await import('@modules/inbox/schema')
  const db = requireDb() as {
    select: () => {
      from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } }
    }
    update: (t: unknown) => {
      set: (v: unknown) => {
        where: (c: unknown) => { returning: () => Promise<unknown[]> }
      }
    }
  }

  // Flip the row to the chosen status — guarded so we only decide pending rows.
  const updated = (await db
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

  const convRows = (await db
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
  if (_scheduler) {
    await _scheduler.enqueue(trigger, { agentId, organizationId: approval.organizationId })
    enqueued = true
  }

  return { approval, trigger, agentId, enqueued }
}

/**
 * Staff-signal bridge: persist the rejection note as an internal note so it
 * shows on the conversation timeline and `detectStaffSignals()` picks it up on
 * the resumed wake. Best-effort — the caller swallows failures so a note write
 * can never block a decide.
 */
export async function persistRejectionNote(
  approval: PendingApproval,
  decidedByUserId: string,
  body: string,
): Promise<void> {
  const { addNote } = await import('./notes')
  await addNote({
    organizationId: approval.organizationId,
    conversationId: approval.conversationId,
    author: { kind: 'staff', id: decidedByUserId },
    body: `Approval rejected: ${body}`,
  })
}
