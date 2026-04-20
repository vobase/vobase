/**
 * conversations service — Model A (one row per (organization, contact, channelInstance)).
 *
 * Every mutation is transactional and writes an audit row to
 * `agents.conversation_events` in the same tx. Non-agent lifecycle events use
 * the shape `{ type: 'conversation.<verb>', payload: {...} }` — these are out
 * of the agent event stream (AgentEvent union) on purpose: they're timeline
 * audit records, not wake-loop events.
 *
 * Only `modules/inbox/state.ts` owns `applyTransition`; this file calls
 * `transitionConversation(current, next)` exported from state.ts.
 */
import type { Conversation, Message } from '@server/contracts/domain-types'
import type {
  CreateConversationInput,
  CreateInboundMessageInput,
  CreateInboundMessageResult,
} from '@server/contracts/inbox-port'
import { transitionConversation } from '../state'

let _db: unknown = null
let _scheduler: ConversationScheduler | null = null

/** Minimal pg-boss-shaped binding — enough for snooze/unsnooze without pulling pg-boss types. */
export interface ConversationScheduler {
  send(
    name: string,
    data: Record<string, unknown>,
    opts?: { startAfter?: Date; singletonKey?: string },
  ): Promise<string>
  cancel(jobId: string): Promise<void>
}

export function setDb(db: unknown): void {
  _db = db
}

export function setScheduler(scheduler: ConversationScheduler): void {
  _scheduler = scheduler
}

// ─── narrow drizzle shapes ─────────────────────────────────────────────────
type Rows<T = unknown> = Promise<T[]>
type InsertChain = {
  values: (v: unknown) => { returning: () => Rows; onConflictDoNothing: () => { returning: () => Rows } }
}
type SelectChain = {
  from: (t: unknown) => {
    where: (c: unknown) => {
      limit: (n: number) => Rows
      orderBy: (col: unknown) => { limit: (n: number) => Rows }
    }
  }
}
type UpdateChain = {
  set: (v: unknown) => { where: (c: unknown) => { returning: () => Rows } }
}
type DbHandle = {
  insert: (t: unknown) => InsertChain
  select: (fields?: unknown) => SelectChain
  update: (t: unknown) => UpdateChain
  transaction: <T>(fn: (tx: DbHandle) => Promise<T>) => Promise<T>
}

function requireDb(): DbHandle {
  if (!_db) throw new Error('inbox/conversations: db not initialised — call setDb() in module init')
  return _db as DbHandle
}

interface ConversationEventInput {
  conversationId: string
  organizationId: string
  type: string
  payload: Record<string, unknown>
}

async function writeConversationEvent(runner: DbHandle, input: ConversationEventInput): Promise<void> {
  const { conversationEvents } = await import('@modules/agents/schema')
  await runner
    .insert(conversationEvents)
    .values({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      wakeId: null,
      turnIndex: 0,
      type: input.type,
      payload: input.payload,
    })
    .returning()
}

// ─── shared patch constants ────────────────────────────────────────────────
const CLEAR_SNOOZE = {
  snoozedUntil: null,
  snoozedReason: null,
  snoozedBy: null,
  snoozedAt: null,
  snoozedJobId: null,
} as const

const CLEAR_RESOLVED = { resolvedAt: null, resolvedReason: null } as const

// ─── create / read ────────────────────────────────────────────────────────

export async function create(input: CreateConversationInput): Promise<Conversation> {
  const { conversations } = await import('@modules/inbox/schema')
  const db = requireDb()

  const rows = await db
    .insert(conversations)
    .values({
      organizationId: input.organizationId,
      contactId: input.contactId,
      channelInstanceId: input.channelInstanceId,
      status: input.status,
      assignee: input.assignee,
      threadKey: input.threadKey ?? 'default',
      emailSubject: input.emailSubject ?? null,
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('inbox/conversations.create: insert returned no rows')
  return row as Conversation
}

/**
 * Model A — exactly one row per (organization, contact, channelInstance, threadKey).
 *
 * Uses the unique index `idx_conv_one_per_pair` as the idempotency boundary:
 * INSERT ... ON CONFLICT DO NOTHING, then SELECT the current row. Chat
 * channels pass `threadKey='default'` (one row per pair). Email passes the
 * RFC 5322 thread root so each topic gets its own row.
 */
export async function resumeOrCreate(
  organizationId: string,
  contactId: string,
  channelInstanceId: string,
  threadKey = 'default',
): Promise<{ conversation: Conversation; created: boolean }> {
  const { conversations } = await import('@modules/inbox/schema')
  const { and, eq } = await import('drizzle-orm')
  const db = requireDb()

  const inserted = (await db
    .insert(conversations)
    .values({
      organizationId,
      contactId,
      channelInstanceId,
      status: 'active',
      assignee: 'unassigned',
      threadKey,
    })
    .onConflictDoNothing()
    .returning()) as Conversation[]

  if (inserted[0]) return { conversation: inserted[0], created: true }

  const rows = (await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.contactId, contactId),
        eq(conversations.channelInstanceId, channelInstanceId),
        eq(conversations.threadKey, threadKey),
      ),
    )
    .limit(1)) as Conversation[]

  const row = rows[0]
  if (!row) throw new Error('inbox/conversations.resumeOrCreate: no row found after upsert')
  return { conversation: row, created: false }
}

export async function get(id: string): Promise<Conversation> {
  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()
  const rows = (await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)) as Conversation[]
  const row = rows[0]
  if (!row) throw new Error(`conversation not found: ${id}`)
  return row
}

// ─── inbound write path ────────────────────────────────────────────────────

/**
 * Create an inbound customer message.
 *
 * Conversation-lifecycle side effects (all atomic with message insert):
 *   - `status='resolved'` → flip to `active` + write `conversation.reopened`
 *     event. Inbound wakes resolved conversations.
 *   - `status='failed'`   → reject. Failed conversations never auto-wake;
 *     staff must `staff_reset` first.
 *   - `snoozedUntil IS NOT NULL` → clear snooze (all 5 fields) + write
 *     `conversation.unsnoozed` event. Also cancels the pg-boss wake job.
 */
export async function createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult> {
  const { conversation, created } = await resumeOrCreate(
    input.organizationId,
    input.contactId,
    input.channelInstanceId,
    input.threadKey ?? 'default',
  )
  const { conversations, messages } = await import('@modules/inbox/schema')
  const { and, eq } = await import('drizzle-orm')
  const db = requireDb()

  if (conversation.status === 'failed') {
    throw new ConversationFailedError(conversation.id)
  }

  // Dedup on channelExternalId before any state mutation.
  const existing = (await db
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, input.organizationId), eq(messages.channelExternalId, input.externalMessageId)))
    .limit(1)) as Message[]

  if (existing[0]) return { conversation, message: existing[0], isNew: false }

  const kind = input.contentType === 'image' ? 'image' : 'text'
  const { message, nextConversation, cancelJobId } = await db.transaction(async (tx) => {
    const msgRows = (await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        organizationId: input.organizationId,
        role: 'customer',
        kind,
        content: { text: input.content },
        channelExternalId: input.externalMessageId,
      })
      .returning()) as Message[]
    const msg = msgRows[0]
    if (!msg) throw new Error('inbox/conversations.createInboundMessage: insert returned no rows')

    const patch: Record<string, unknown> = { lastMessageAt: new Date(), updatedAt: new Date() }
    let nextStatus = conversation.status
    let cancelJobIdLocal: string | null = null

    // Populate emailSubject on the first inbound that opens a new thread.
    if (created && input.emailSubject && !conversation.emailSubject) {
      patch.emailSubject = input.emailSubject
    }

    if (conversation.status === 'resolved') {
      nextStatus = transitionConversation(conversation.status, 'active')
      patch.status = nextStatus
      Object.assign(patch, CLEAR_RESOLVED)
    }

    if (conversation.snoozedUntil) {
      cancelJobIdLocal = conversation.snoozedJobId
      Object.assign(patch, CLEAR_SNOOZE)
    }

    const updatedRows = (await tx
      .update(conversations)
      .set(patch)
      .where(eq(conversations.id, conversation.id))
      .returning()) as Conversation[]
    const updated = updatedRows[0]
    if (!updated) throw new Error('inbox/conversations.createInboundMessage: update returned no rows')

    if (conversation.status === 'resolved') {
      await writeConversationEvent(tx, {
        conversationId: conversation.id,
        organizationId: input.organizationId,
        type: 'conversation.reopened',
        payload: { trigger: 'new_inbound' },
      })
    }

    if (conversation.snoozedUntil) {
      await writeConversationEvent(tx, {
        conversationId: conversation.id,
        organizationId: input.organizationId,
        type: 'conversation.unsnoozed',
        payload: { trigger: 'new_inbound', originalUntil: conversation.snoozedUntil.toISOString() },
      })
    }

    return { message: msg, nextConversation: updated, cancelJobId: cancelJobIdLocal }
  })

  if (cancelJobId && _scheduler) {
    await _scheduler.cancel(cancelJobId).catch(() => undefined)
  }

  return { conversation: nextConversation, message, isNew: true }
}

// ─── mutators ──────────────────────────────────────────────────────────────

export class ConversationFailedError extends Error {
  readonly code = 'CONVERSATION_FAILED'
  constructor(id: string) {
    super(`conversation ${id} is in failed state — staff_reset required before further activity`)
  }
}

export class SnoozeNotAllowedError extends Error {
  readonly code = 'SNOOZE_NOT_ALLOWED'
  constructor(status: string) {
    super(`cannot snooze conversation in status '${status}' — only plain active conversations may be snoozed`)
  }
}

export interface SnoozeInput {
  conversationId: string
  until: Date
  by: string
  reason?: string
}

export async function snooze(input: SnoozeInput): Promise<Conversation> {
  const current = await get(input.conversationId)
  if (current.status !== 'active') throw new SnoozeNotAllowedError(current.status)
  if (current.snoozedUntil && current.snoozedUntil.getTime() > Date.now()) {
    // already snoozed — cancel previous before re-snooze
    if (current.snoozedJobId && _scheduler) {
      await _scheduler.cancel(current.snoozedJobId).catch(() => undefined)
    }
  }

  const snoozedAt = new Date()
  let jobId: string | null = null
  if (_scheduler) {
    jobId = await _scheduler
      .send(
        'inbox:wake-snoozed',
        { conversationId: input.conversationId, snoozedAt: snoozedAt.toISOString() },
        { startAfter: input.until, singletonKey: `inbox:wake-snoozed:${input.conversationId}:${snoozedAt.getTime()}` },
      )
      .catch(() => null)
  }

  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  return db.transaction(async (tx) => {
    const rows = (await tx
      .update(conversations)
      .set({
        snoozedUntil: input.until,
        snoozedReason: input.reason ?? null,
        snoozedBy: input.by,
        snoozedAt,
        snoozedJobId: jobId,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, input.conversationId))
      .returning()) as Conversation[]
    const row = rows[0]
    if (!row) throw new Error(`inbox/conversations.snooze: not found: ${input.conversationId}`)

    await writeConversationEvent(tx, {
      conversationId: input.conversationId,
      organizationId: row.organizationId,
      type: 'conversation.snoozed',
      payload: { until: input.until.toISOString(), reason: input.reason ?? null, by: input.by },
    })
    return row
  })
}

export async function unsnooze(conversationId: string, by: string): Promise<Conversation> {
  const current = await get(conversationId)
  if (!current.snoozedUntil) return current

  if (current.snoozedJobId && _scheduler) {
    await _scheduler.cancel(current.snoozedJobId).catch(() => undefined)
  }

  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  return db.transaction(async (tx) => {
    const rows = (await tx
      .update(conversations)
      .set({ ...CLEAR_SNOOZE, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning()) as Conversation[]
    const row = rows[0]
    if (!row) throw new Error(`inbox/conversations.unsnooze: not found: ${conversationId}`)

    await writeConversationEvent(tx, {
      conversationId,
      organizationId: row.organizationId,
      type: 'conversation.unsnoozed',
      payload: { by },
    })
    return row
  })
}

/**
 * Wake handler for `inbox:wake-snoozed`. Idempotency: the caller passes the
 * `snoozedAt` that was stored when the snooze was created. If the current row's
 * `snoozedAt` differs (staff re-snoozed or un-snoozed), the wake is a no-op.
 */
export async function wakeSnoozed(conversationId: string, snoozedAtIso: string): Promise<{ woken: boolean }> {
  const current = await get(conversationId)
  const originalUntil = current.snoozedUntil
  if (!originalUntil || !current.snoozedAt) return { woken: false }
  if (current.snoozedAt.toISOString() !== snoozedAtIso) return { woken: false }

  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ ...CLEAR_SNOOZE, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning()

    await writeConversationEvent(tx, {
      conversationId,
      organizationId: current.organizationId,
      type: 'conversation.snooze_expired',
      payload: { originalUntil: originalUntil.toISOString() },
    })
  })

  return { woken: true }
}

// ─── resolve / reopen / reset ──────────────────────────────────────────────

export async function resolve(conversationId: string, by: string, reason?: string): Promise<Conversation> {
  const current = await get(conversationId)
  const nextStatus = transitionConversation(current.status, 'resolved')
  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  return db.transaction(async (tx) => {
    const rows = (await tx
      .update(conversations)
      .set({
        status: nextStatus,
        resolvedAt: new Date(),
        resolvedReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning()) as Conversation[]
    const row = rows[0]
    if (!row) throw new Error(`inbox/conversations.resolve: not found: ${conversationId}`)

    await writeConversationEvent(tx, {
      conversationId,
      organizationId: row.organizationId,
      type: 'conversation.resolved',
      payload: { by, reason: reason ?? null },
    })
    return row
  })
}

export type ReopenTrigger = 'staff_reopen' | 'new_inbound' | 'staff_reset'

export async function reopen(
  conversationId: string,
  by: string,
  trigger: ReopenTrigger = 'staff_reopen',
): Promise<Conversation> {
  const current = await get(conversationId)
  const nextStatus = transitionConversation(current.status, 'active')
  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  return db.transaction(async (tx) => {
    const rows = (await tx
      .update(conversations)
      .set({ status: nextStatus, ...CLEAR_RESOLVED, ...CLEAR_SNOOZE, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning()) as Conversation[]
    const row = rows[0]
    if (!row) throw new Error(`inbox/conversations.reopen: not found: ${conversationId}`)

    await writeConversationEvent(tx, {
      conversationId,
      organizationId: row.organizationId,
      type: 'conversation.reopened',
      payload: { by, trigger },
    })
    return row
  })
}

/** Staff-only: failed → active. Separate from reopen because failed is a dead-end for auto-recovery. */
export async function reset(conversationId: string, by: string): Promise<Conversation> {
  return reopen(conversationId, by, 'staff_reset')
}

// ─── reassign ──────────────────────────────────────────────────────────────

export async function reassign(
  conversationId: string,
  assignee: string,
  by: string,
  reason?: string,
): Promise<Conversation> {
  const current = await get(conversationId)
  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  return db.transaction(async (tx) => {
    const rows = (await tx
      .update(conversations)
      .set({ assignee, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning()) as Conversation[]
    const row = rows[0]
    if (!row) throw new Error(`inbox/conversations.reassign: not found: ${conversationId}`)

    await writeConversationEvent(tx, {
      conversationId,
      organizationId: row.organizationId,
      type: 'conversation.reassigned',
      payload: { from: current.assignee, to: assignee, reason: reason ?? null, by },
    })
    return row
  })
}

// ─── list / stubs used by handlers ─────────────────────────────────────────

export async function sendText(_input: unknown): Promise<unknown> {
  throw new Error('not-implemented: inbox/conversations.sendText — use messages.appendTextMessage')
}

export async function sendCard(_input: unknown): Promise<unknown> {
  throw new Error('not-implemented: inbox/conversations.sendCard — use messages.appendCardMessage')
}

export async function sendImage(_input: unknown): Promise<unknown> {
  throw new Error('not-implemented: inbox/conversations.sendImage')
}

export async function hold(_conversationId: string, _reason: string): Promise<void> {
  throw new Error('removed-in-model-a: inbox/conversations.hold — use snooze() instead')
}

export async function beginCompaction(
  _conversationId: string,
  _summary: string,
): Promise<{ childConversationId: string }> {
  throw new Error(
    'removed-in-model-a: compaction is a workspace/materializer concern, not a conversation lifecycle state',
  )
}

export interface ListOpts {
  status?: string[]
  tab?: 'active' | 'later' | 'done'
  owner?: string
  now?: Date
}

export async function list(organizationId: string, opts?: ListOpts): Promise<Conversation[]> {
  const { conversations } = await import('@modules/inbox/schema')
  const { and, desc, eq, gt, inArray, isNotNull, or, sql } = await import('drizzle-orm')
  const db = requireDb()

  const now = opts?.now ?? new Date()
  const conds: unknown[] = [eq(conversations.organizationId, organizationId)]

  if (opts?.status?.length) {
    conds.push(inArray(conversations.status, opts.status))
  }

  if (opts?.tab === 'done') {
    conds.push(inArray(conversations.status, ['resolved', 'failed']))
  } else if (opts?.tab === 'later') {
    conds.push(isNotNull(conversations.snoozedUntil))
    conds.push(gt(conversations.snoozedUntil, now))
  } else if (opts?.tab === 'active') {
    // not done AND not (snoozed in future)
    conds.push(inArray(conversations.status, ['active', 'resolving', 'awaiting_approval']))
    // snoozedUntil IS NULL OR snoozedUntil <= now
    conds.push(
      or(sql`${conversations.snoozedUntil} IS NULL`, sql`${conversations.snoozedUntil} <= ${now.toISOString()}`),
    )
  }

  if (opts?.owner && opts.owner !== 'all') {
    if (opts.owner === 'unassigned') {
      conds.push(eq(conversations.assignee, 'unassigned'))
    } else if (opts.owner === 'mine') {
      // "mine" is a placeholder until staff user identity lands. Until then treat
      // as assigned-to-any-user — matches the v1 `assigned_to_me` heuristic.
      conds.push(sql`${conversations.assignee} != 'unassigned'`)
    } else {
      conds.push(eq(conversations.assignee, opts.owner))
    }
  }

  const whereClause = conds.length === 1 ? conds[0] : and(...(conds as Parameters<typeof and>))

  const rows = (await db
    .select()
    .from(conversations)
    .where(whereClause)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100)) as unknown[]

  return rows as Conversation[]
}
