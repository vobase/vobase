/**
 * Approval-gate primitive: pause a wake when a tool with
 * `requiresApproval = true` is about to dispatch, persist the context the
 * resumer needs, and resolve cleanly when a staff member decides.
 *
 * Three transitions live here:
 *   - `requestApproval()`  — running → pending_approval. Writes a
 *     `pending_approvals` row + journals `approval_requested` +
 *     `wake_state_changed`.
 *   - `resolveApproval()`  — pending_approval → awaiting_resume. Writes the
 *     decision back, journals `approval_resolved` + `wake_state_changed`.
 *   - `expireApproval()`   — pending_approval → aborted. Called by the 24h
 *     timeout sweeper; journals a rejection + state change.
 *
 * The actual resumption (re-acquire lease, re-dispatch tool with the saved
 * context) is owned by the wake-resumer job in template land — this module
 * only governs the persistence + journal contract.
 */

import { and, eq, lt, sql } from 'drizzle-orm'

import type { DrizzleHandleShape } from '../db/types'
import { pendingApprovals } from '../schemas/harness'
import { append } from './journal'
import type { ApprovalRequestedEvent, ApprovalResolvedEvent, WakeStateChangedEvent } from './types'

/** Default approval lifetime — tasks.md spec: 24h sweeper. */
export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

interface PendingApprovalRow {
  id: string
  organizationId: string
  wakeId: string
  conversationId: string
  agentId: string
  turnIndex: number
  toolCallId: string
  toolName: string
  toolInput: unknown
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  decidedByUserId: string | null
  decidedNote: string | null
  requestedAt: Date
  decidedAt: Date | null
  expiresAt: Date
}

type InsertChain = { values: (vals: unknown) => Promise<unknown> }
type UpdateChain = {
  set: (patch: Record<string, unknown>) => {
    where: (cond: unknown) => Promise<{ rowCount?: number }>
  }
}
type SelectChain = {
  from: (table: unknown) => {
    where: (cond: unknown) => {
      limit?: (n: number) => Promise<PendingApprovalRow[]>
    } & Promise<PendingApprovalRow[]>
  }
}

interface ApprovalDb extends DrizzleHandleShape {
  insert: (table: unknown) => InsertChain
  update: (table: unknown) => UpdateChain
  select: () => SelectChain
}

export interface RequestApprovalInput {
  organizationId: string
  wakeId: string
  conversationId: string
  agentId: string
  turnIndex: number
  toolCallId: string
  toolName: string
  toolInput: unknown
  reason?: string
  ttlMs?: number
  /** Override clock for tests. */
  now?: () => Date
}

export interface ResolveApprovalInput {
  organizationId: string
  wakeId: string
  conversationId: string
  agentId: string
  turnIndex: number
  toolCallId: string
  decision: 'approved' | 'rejected'
  decidedByUserId: string
  note?: string
  now?: () => Date
}

export interface ExpireApprovalInput {
  organizationId: string
  wakeId: string
  conversationId: string
  agentId: string
  turnIndex: number
  toolCallId: string
  now?: () => Date
}

export interface ApprovalGate {
  requestApproval(input: RequestApprovalInput): Promise<void>
  resolveApproval(input: ResolveApprovalInput): Promise<void>
  expireApproval(input: ExpireApprovalInput): Promise<void>
  /** Sweep-and-expire entry point for the 24h pg-boss recurring job. */
  expireOverdue(args?: { now?: Date; batchSize?: number }): Promise<{ expired: number }>
}

export interface ApprovalGateDeps {
  db: ApprovalDb
}

export function createApprovalGate(deps: ApprovalGateDeps): ApprovalGate {
  const db = deps.db

  async function emitStateChange(
    base: Omit<WakeStateChangedEvent, 'type' | 'ts' | 'from' | 'to' | 'reason'>,
    from: WakeStateChangedEvent['from'],
    to: WakeStateChangedEvent['to'],
    reason: string,
    now: Date,
  ): Promise<void> {
    const event: WakeStateChangedEvent = {
      type: 'wake_state_changed',
      ts: now,
      wakeId: base.wakeId,
      conversationId: base.conversationId,
      organizationId: base.organizationId,
      turnIndex: base.turnIndex,
      from,
      to,
      reason,
    }
    await append({
      conversationId: base.conversationId,
      organizationId: base.organizationId,
      wakeId: base.wakeId,
      turnIndex: base.turnIndex,
      event,
    })
  }

  async function requestApproval(input: RequestApprovalInput): Promise<void> {
    const now = (input.now ?? (() => new Date()))()
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS))

    await db.insert(pendingApprovals).values({
      organizationId: input.organizationId,
      wakeId: input.wakeId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      turnIndex: input.turnIndex,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      reason: input.reason ?? null,
      status: 'pending',
      requestedAt: now,
      expiresAt,
    })

    const requested: ApprovalRequestedEvent = {
      type: 'approval_requested',
      ts: now,
      wakeId: input.wakeId,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      turnIndex: input.turnIndex,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      requestedByAgentId: input.agentId,
      toolInput: input.toolInput,
      reason: input.reason,
    }
    await append({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      wakeId: input.wakeId,
      turnIndex: input.turnIndex,
      event: requested,
    })

    await emitStateChange(
      {
        wakeId: input.wakeId,
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        turnIndex: input.turnIndex,
      },
      'running',
      'pending_approval',
      `tool ${input.toolName} (${input.toolCallId}) requires approval`,
      now,
    )
  }

  async function resolveApproval(input: ResolveApprovalInput): Promise<void> {
    const now = (input.now ?? (() => new Date()))()

    await db
      .update(pendingApprovals)
      .set({
        status: input.decision,
        decidedByUserId: input.decidedByUserId,
        decidedNote: input.note ?? null,
        decidedAt: now,
      })
      .where(and(eq(pendingApprovals.wakeId, input.wakeId), eq(pendingApprovals.toolCallId, input.toolCallId)))

    const resolved: ApprovalResolvedEvent = {
      type: 'approval_resolved',
      ts: now,
      wakeId: input.wakeId,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      turnIndex: input.turnIndex,
      toolCallId: input.toolCallId,
      decision: input.decision,
      decidedByUserId: input.decidedByUserId,
      note: input.note,
    }
    await append({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      wakeId: input.wakeId,
      turnIndex: input.turnIndex,
      event: resolved,
    })

    await emitStateChange(
      {
        wakeId: input.wakeId,
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        turnIndex: input.turnIndex,
      },
      'pending_approval',
      'awaiting_resume',
      `approval ${input.decision} by ${input.decidedByUserId}`,
      now,
    )
  }

  async function expireApproval(input: ExpireApprovalInput): Promise<void> {
    const now = (input.now ?? (() => new Date()))()

    await db
      .update(pendingApprovals)
      .set({ status: 'expired', decidedAt: now })
      .where(and(eq(pendingApprovals.wakeId, input.wakeId), eq(pendingApprovals.toolCallId, input.toolCallId)))

    await emitStateChange(
      {
        wakeId: input.wakeId,
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        turnIndex: input.turnIndex,
      },
      'pending_approval',
      'aborted',
      'approval expired (24h timeout)',
      now,
    )
  }

  async function expireOverdue(args?: { now?: Date; batchSize?: number }): Promise<{ expired: number }> {
    const now = args?.now ?? new Date()
    const limit = args?.batchSize ?? 200

    const overdueChain = db
      .select()
      .from(pendingApprovals)
      .where(and(eq(pendingApprovals.status, 'pending'), lt(pendingApprovals.expiresAt, now))) as unknown as {
      limit?: (n: number) => Promise<PendingApprovalRow[]>
    } & Promise<PendingApprovalRow[]>

    const overdue = overdueChain.limit ? await overdueChain.limit(limit) : await overdueChain
    let expired = 0
    for (const row of overdue) {
      await expireApproval({
        organizationId: row.organizationId,
        wakeId: row.wakeId,
        conversationId: row.conversationId,
        agentId: row.agentId,
        turnIndex: row.turnIndex,
        toolCallId: row.toolCallId,
        now: () => now,
      })
      expired += 1
    }
    return { expired }
  }

  return { requestApproval, resolveApproval, expireApproval, expireOverdue }
}

let _currentApprovalGate: ApprovalGate | null = null

export function installApprovalGate(svc: ApprovalGate): void {
  _currentApprovalGate = svc
}

export function __resetApprovalGateForTests(): void {
  _currentApprovalGate = null
}

function current(): ApprovalGate {
  if (!_currentApprovalGate) {
    throw new Error('harness/approval-gate: gate not installed — call installApprovalGate() during boot')
  }
  return _currentApprovalGate
}

export function setApprovalGateDb(db: unknown): void {
  installApprovalGate(createApprovalGate({ db: db as ApprovalDb }))
}

export function requestApproval(input: RequestApprovalInput): Promise<void> {
  return current().requestApproval(input)
}
export function resolveApproval(input: ResolveApprovalInput): Promise<void> {
  return current().resolveApproval(input)
}
export function expireApproval(input: ExpireApprovalInput): Promise<void> {
  return current().expireApproval(input)
}
export function expireOverdueApprovals(args?: { now?: Date; batchSize?: number }): Promise<{ expired: number }> {
  return current().expireOverdue(args)
}

// Re-export the SQL helper alias so callers don't need to import it through
// the approval-gate to compose where-clauses.
export { sql }
