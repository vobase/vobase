/**
 * conversations service — Model A (one row per (organization, contact, channelInstance)).
 *
 * Every mutation is transactional and writes an audit row to
 * `agents.conversation_events` in the same tx. Only `modules/messaging/state.ts`
 * owns `applyTransition`; this file calls `transitionConversation(...)` from
 * state.ts.
 *
 * Factory-DI service. `createConversationsService({ db, scheduler })`
 * returns the bound API; free-function wrappers route through the installed
 * instance to preserve the existing import surface.
 */
import { channelInstances } from '@modules/channels/schema'
import { conversationEvents } from '@vobase/core'
import { and, desc, eq, getTableColumns, gt, inArray, isNotNull, or, sql } from 'drizzle-orm'

import { type Conversation, conversations, type Message, messages } from '../schema'
import { transitionConversation } from '../state'
import { computeTab } from './bucketing'
import type { CreateConversationInput, CreateInboundMessageInput, CreateInboundMessageResult } from './types'

/** Minimal pg-boss-shaped binding — enough for snooze/unsnooze without pulling pg-boss types. */
export interface ConversationScheduler {
  send(
    name: string,
    data: Record<string, unknown>,
    opts?: { startAfter?: Date; singletonKey?: string },
  ): Promise<string>
  cancel(jobId: string): Promise<void>
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

/** Escape hatch for building a `.as('alias')` subquery — not representable via DbHandle. */
type Subquery<TFields> = TFields & { _isSubquery: true }
type SubqueryBuilder<TFields> = {
  from: (t: unknown) => {
    where: (c: unknown) => {
      orderBy: (col: unknown) => { limit: (n: number) => { as: (alias: string) => Subquery<TFields> } }
    }
  }
}
type DbWithSubquery = { select: <T>(fields: T) => SubqueryBuilder<T> }

/** Escape hatch for `leftJoinLateral` + `leftJoin` — not representable via DbHandle. */
type LateralSelectChain = {
  from: (t: unknown) => {
    leftJoin: (
      table: unknown,
      on: unknown,
    ) => {
      leftJoinLateral: (
        subq: unknown,
        on: unknown,
      ) => {
        where: (c: unknown) => {
          orderBy: (col: unknown) => { limit: (n: number) => Promise<unknown[]> }
        }
      }
    }
  }
}
type DbWithLateral = { select: (fields: unknown) => LateralSelectChain }

// ─── shared patch constants ────────────────────────────────────────────────
const CLEAR_SNOOZE = {
  snoozedUntil: null,
  snoozedReason: null,
  snoozedBy: null,
  snoozedAt: null,
  snoozedJobId: null,
} as const

const CLEAR_RESOLVED = { resolvedAt: null, resolvedReason: null } as const

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

export type ReopenTrigger = 'staff_reopen' | 'new_inbound' | 'staff_reset'

export interface ListOpts {
  status?: string[]
  tab?: 'active' | 'later' | 'done'
  owner?: string
  contactId?: string
  now?: Date
}

export interface ActivityEvent {
  id: string
  conversationId: string
  ts: string
  type: string
  payload: Record<string, unknown>
}

export const TIMELINE_ACTIVITY_TYPES = [
  'conversation.reassigned',
  'conversation.resolved',
  'conversation.reopened',
  'conversation.snoozed',
  'conversation.unsnoozed',
  'conversation.snooze_expired',
] as const

export interface ConversationsService {
  create(input: CreateConversationInput): Promise<Conversation>
  resumeOrCreate(
    organizationId: string,
    contactId: string,
    channelInstanceId: string,
    threadKey?: string,
    initialAssignee?: string | null,
  ): Promise<{ conversation: Conversation; created: boolean }>
  get(id: string): Promise<Conversation>
  listActivity(conversationId: string): Promise<ActivityEvent[]>
  createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult>
  snooze(input: SnoozeInput): Promise<Conversation>
  unsnooze(conversationId: string, by: string): Promise<Conversation>
  wakeSnoozed(conversationId: string, snoozedAtIso: string): Promise<{ woken: boolean }>
  resolve(conversationId: string, by: string, reason?: string): Promise<Conversation>
  reopen(conversationId: string, by: string, trigger?: ReopenTrigger): Promise<Conversation>
  reset(conversationId: string, by: string): Promise<Conversation>
  reassign(conversationId: string, assignee: string, by: string, reason?: string): Promise<Conversation>
  list(organizationId: string, opts?: ListOpts): Promise<Conversation[]>
  listMessagingByContact(
    organizationId: string,
    opts?: Omit<ListOpts, 'tab' | 'contactId'>,
  ): Promise<{ rows: Conversation[]; counts: { active: number; later: number; done: number } }>
  sendText(input: unknown): Promise<unknown>
  sendCard(input: unknown): Promise<unknown>
  sendImage(input: unknown): Promise<unknown>
}

export interface ConversationsServiceDeps {
  db: unknown
  scheduler?: ConversationScheduler | null
}

export function createConversationsService(deps: ConversationsServiceDeps): ConversationsService {
  const db = deps.db as DbHandle
  const scheduler = deps.scheduler ?? null

  async function writeConversationEvent(
    runner: DbHandle,
    input: { conversationId: string; organizationId: string; type: string; payload: Record<string, unknown> },
  ): Promise<void> {
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

  async function create(input: CreateConversationInput): Promise<Conversation> {
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
    if (!row) throw new Error('messaging/conversations.create: insert returned no rows')
    return row as Conversation
  }

  async function resumeOrCreate(
    organizationId: string,
    contactId: string,
    channelInstanceId: string,
    threadKey = 'default',
    initialAssignee?: string | null,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const inserted = (await db
      .insert(conversations)
      .values({
        organizationId,
        contactId,
        channelInstanceId,
        status: 'active',
        assignee: initialAssignee ?? 'unassigned',
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
    if (!row) throw new Error('messaging/conversations.resumeOrCreate: no row found after upsert')
    return { conversation: row, created: false }
  }

  async function get(id: string): Promise<Conversation> {
    const rows = (await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)) as Conversation[]
    const row = rows[0]
    if (!row) throw new Error(`conversation not found: ${id}`)
    return row
  }

  async function createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult> {
    const { conversation, created } = await resumeOrCreate(
      input.organizationId,
      input.contactId,
      input.channelInstanceId,
      input.threadKey ?? 'default',
      input.initialAssignee ?? null,
    )

    if (conversation.status === 'failed') {
      throw new ConversationFailedError(conversation.id)
    }

    const existing = (await db
      .select()
      .from(messages)
      .where(
        and(eq(messages.organizationId, input.organizationId), eq(messages.channelExternalId, input.externalMessageId)),
      )
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
      if (!msg) throw new Error('messaging/conversations.createInboundMessage: insert returned no rows')

      const patch: Record<string, unknown> = { lastMessageAt: new Date(), updatedAt: new Date() }
      let nextStatus = conversation.status
      let cancelJobIdLocal: string | null = null

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
      if (!updated) throw new Error('messaging/conversations.createInboundMessage: update returned no rows')

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

    if (cancelJobId && scheduler) {
      await scheduler.cancel(cancelJobId).catch(() => undefined)
    }

    return { conversation: nextConversation, message, isNew: true }
  }

  async function snooze(input: SnoozeInput): Promise<Conversation> {
    const current = await get(input.conversationId)
    if (current.status !== 'active') throw new SnoozeNotAllowedError(current.status)
    if (current.snoozedUntil && current.snoozedUntil.getTime() > Date.now()) {
      if (current.snoozedJobId && scheduler) {
        await scheduler.cancel(current.snoozedJobId).catch(() => undefined)
      }
    }

    const snoozedAt = new Date()

    const row = await db.transaction(async (tx) => {
      const rows = (await tx
        .update(conversations)
        .set({
          snoozedUntil: input.until,
          snoozedReason: input.reason ?? null,
          snoozedBy: input.by,
          snoozedAt,
          snoozedJobId: null,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, input.conversationId))
        .returning()) as Conversation[]
      const r = rows[0]
      if (!r) throw new Error(`messaging/conversations.snooze: not found: ${input.conversationId}`)

      await writeConversationEvent(tx, {
        conversationId: input.conversationId,
        organizationId: r.organizationId,
        type: 'conversation.snoozed',
        payload: { until: input.until.toISOString(), reason: input.reason ?? null, by: input.by },
      })
      return r
    })

    // Queue the wake-snoozed job AFTER the tx commits. Otherwise the dev
    // in-process queue races the tx and wakeSnoozed reads a stale row, so
    // its `current.snoozedAt !== snoozedAtIso` guard short-circuits to a
    // silent no-op and the conversation stays snoozed forever.
    if (scheduler) {
      const jobId = await scheduler
        .send(
          'messaging:wake-snoozed',
          { conversationId: input.conversationId, snoozedAt: snoozedAt.toISOString() },
          {
            startAfter: input.until,
            singletonKey: `messaging:wake-snoozed:${input.conversationId}:${snoozedAt.getTime()}`,
          },
        )
        .catch(() => null)
      if (jobId) {
        await db.update(conversations).set({ snoozedJobId: jobId }).where(eq(conversations.id, input.conversationId))
        return { ...row, snoozedJobId: jobId }
      }
    }

    return row
  }

  async function unsnooze(conversationId: string, by: string): Promise<Conversation> {
    const current = await get(conversationId)
    if (!current.snoozedUntil) return current

    if (current.snoozedJobId && scheduler) {
      await scheduler.cancel(current.snoozedJobId).catch(() => undefined)
    }

    return db.transaction(async (tx) => {
      const rows = (await tx
        .update(conversations)
        .set({ ...CLEAR_SNOOZE, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
        .returning()) as Conversation[]
      const row = rows[0]
      if (!row) throw new Error(`messaging/conversations.unsnooze: not found: ${conversationId}`)

      await writeConversationEvent(tx, {
        conversationId,
        organizationId: row.organizationId,
        type: 'conversation.unsnoozed',
        payload: { by },
      })
      return row
    })
  }

  async function wakeSnoozed(conversationId: string, snoozedAtIso: string): Promise<{ woken: boolean }> {
    const current = await get(conversationId)
    const originalUntil = current.snoozedUntil
    if (!originalUntil || !current.snoozedAt) return { woken: false }
    if (current.snoozedAt.toISOString() !== snoozedAtIso) return { woken: false }

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

  async function resolve(conversationId: string, by: string, reason?: string): Promise<Conversation> {
    const current = await get(conversationId)
    const nextStatus = transitionConversation(current.status, 'resolved')

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
      if (!row) throw new Error(`messaging/conversations.resolve: not found: ${conversationId}`)

      await writeConversationEvent(tx, {
        conversationId,
        organizationId: row.organizationId,
        type: 'conversation.resolved',
        payload: { by, reason: reason ?? null },
      })
      return row
    })
  }

  async function reopen(
    conversationId: string,
    by: string,
    trigger: ReopenTrigger = 'staff_reopen',
  ): Promise<Conversation> {
    const current = await get(conversationId)
    const nextStatus = transitionConversation(current.status, 'active')

    return db.transaction(async (tx) => {
      const rows = (await tx
        .update(conversations)
        .set({ status: nextStatus, ...CLEAR_RESOLVED, ...CLEAR_SNOOZE, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
        .returning()) as Conversation[]
      const row = rows[0]
      if (!row) throw new Error(`messaging/conversations.reopen: not found: ${conversationId}`)

      await writeConversationEvent(tx, {
        conversationId,
        organizationId: row.organizationId,
        type: 'conversation.reopened',
        payload: { by, trigger },
      })
      return row
    })
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function reset(conversationId: string, by: string): Promise<Conversation> {
    return reopen(conversationId, by, 'staff_reset')
  }

  async function listActivity(conversationId: string): Promise<ActivityEvent[]> {
    const rows = (await db
      .select({
        id: conversationEvents.id,
        conversationId: conversationEvents.conversationId,
        ts: conversationEvents.ts,
        type: conversationEvents.type,
        payload: conversationEvents.payload,
      })
      .from(conversationEvents)
      .where(
        and(
          eq(conversationEvents.conversationId, conversationId),
          inArray(conversationEvents.type, TIMELINE_ACTIVITY_TYPES as unknown as string[]),
        ),
      )
      .orderBy(conversationEvents.ts)) as unknown as Array<{
      id: bigint | string
      conversationId: string
      ts: Date
      type: string
      payload: Record<string, unknown> | null
    }>
    return rows.map((r) => ({
      id: String(r.id),
      conversationId: r.conversationId,
      ts: r.ts.toISOString(),
      type: r.type,
      payload: r.payload ?? {},
    }))
  }

  async function reassign(
    conversationId: string,
    assignee: string,
    by: string,
    reason?: string,
  ): Promise<Conversation> {
    const current = await get(conversationId)

    return db.transaction(async (tx) => {
      const rows = (await tx
        .update(conversations)
        .set({ assignee, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
        .returning()) as Conversation[]
      const row = rows[0]
      if (!row) throw new Error(`messaging/conversations.reassign: not found: ${conversationId}`)

      await writeConversationEvent(tx, {
        conversationId,
        organizationId: row.organizationId,
        type: 'conversation.reassigned',
        payload: { from: current.assignee, to: assignee, reason: reason ?? null, by },
      })
      return row
    })
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function sendText(_input: unknown): Promise<unknown> {
    throw new Error('not-implemented: messaging/conversations.sendText — use messages.appendTextMessage')
  }
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function sendCard(_input: unknown): Promise<unknown> {
    throw new Error('not-implemented: messaging/conversations.sendCard — use messages.appendCardMessage')
  }
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function sendImage(_input: unknown): Promise<unknown> {
    throw new Error('not-implemented: messaging/conversations.sendImage')
  }
  async function list(organizationId: string, opts?: ListOpts): Promise<Conversation[]> {
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
      conds.push(inArray(conversations.status, ['active', 'resolving', 'awaiting_approval']))
      conds.push(
        or(sql`${conversations.snoozedUntil} IS NULL`, sql`${conversations.snoozedUntil} <= ${now.toISOString()}`),
      )
    }

    if (opts?.owner && opts.owner !== 'all') {
      if (opts.owner === 'unassigned') {
        conds.push(eq(conversations.assignee, 'unassigned'))
      } else if (opts.owner === 'mine') {
        conds.push(sql`${conversations.assignee} != 'unassigned'`)
      } else {
        conds.push(eq(conversations.assignee, opts.owner))
      }
    }

    if (opts?.contactId) {
      conds.push(eq(conversations.contactId, opts.contactId))
    }

    const whereClause = conds.length === 1 ? conds[0] : and(...(conds as Parameters<typeof and>))

    const lastMsg = (db as unknown as DbWithSubquery)
      .select({
        preview: sql<string | null>`${messages.content}->>'text'`.as('preview'),
        kind: messages.kind,
        role: messages.role,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversations.id))
      .orderBy(desc(messages.createdAt))
      .limit(1)
      .as('last_msg')

    const rows = (await (db as unknown as DbWithLateral)
      .select({
        ...getTableColumns(conversations),
        lastMessagePreview: lastMsg.preview,
        lastMessageKind: lastMsg.kind,
        lastMessageRole: lastMsg.role,
        channelInstanceType: channelInstances.channel,
        channelInstanceLabel: channelInstances.displayName,
      })
      .from(conversations)
      .leftJoin(channelInstances, eq(channelInstances.id, conversations.channelInstanceId))
      .leftJoinLateral(lastMsg, sql`true`)
      .where(whereClause)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(100)) as unknown[]

    return rows as Conversation[]
  }

  async function listMessagingByContact(
    organizationId: string,
    opts?: Omit<ListOpts, 'tab' | 'contactId'>,
  ): Promise<{ rows: Conversation[]; counts: { active: number; later: number; done: number } }> {
    const now = opts?.now ?? new Date()
    const all = await list(organizationId, { ...opts, now })
    const reprByContactByTab: Record<'active' | 'later' | 'done', Map<string, Conversation>> = {
      active: new Map(),
      later: new Map(),
      done: new Map(),
    }
    for (const c of all) {
      if (c.channelInstanceType === 'email') continue
      const tab = computeTab(c, now)
      const m = reprByContactByTab[tab]
      const existing = m.get(c.contactId)
      const ta = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0
      const te = existing?.lastMessageAt ? new Date(existing.lastMessageAt).getTime() : -1
      if (!existing || ta > te) m.set(c.contactId, c)
    }
    const merged = [
      ...reprByContactByTab.active.values(),
      ...reprByContactByTab.later.values(),
      ...reprByContactByTab.done.values(),
    ].sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return tb - ta
    })
    return {
      rows: merged,
      counts: {
        active: reprByContactByTab.active.size,
        later: reprByContactByTab.later.size,
        done: reprByContactByTab.done.size,
      },
    }
  }

  return {
    create,
    resumeOrCreate,
    get,
    createInboundMessage,
    snooze,
    unsnooze,
    wakeSnoozed,
    resolve,
    reopen,
    reset,
    reassign,
    listActivity,
    list,
    listMessagingByContact,
    sendText,
    sendCard,
    sendImage,
  }
}

let _currentConversationsService: ConversationsService | null = null

export function installConversationsService(svc: ConversationsService): void {
  _currentConversationsService = svc
}

export function __resetConversationsServiceForTests(): void {
  _currentConversationsService = null
}

function currentConversations(): ConversationsService {
  if (!_currentConversationsService) {
    throw new Error('messaging/conversations: service not installed — call installConversationsService()')
  }
  return _currentConversationsService
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function create(input: CreateConversationInput): Promise<Conversation> {
  return currentConversations().create(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function resumeOrCreate(
  organizationId: string,
  contactId: string,
  channelInstanceId: string,
  threadKey = 'default',
  initialAssignee?: string | null,
): Promise<{ conversation: Conversation; created: boolean }> {
  return currentConversations().resumeOrCreate(organizationId, contactId, channelInstanceId, threadKey, initialAssignee)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function get(id: string): Promise<Conversation> {
  return currentConversations().get(id)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult> {
  return currentConversations().createInboundMessage(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function snooze(input: SnoozeInput): Promise<Conversation> {
  return currentConversations().snooze(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function unsnooze(conversationId: string, by: string): Promise<Conversation> {
  return currentConversations().unsnooze(conversationId, by)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function wakeSnoozed(conversationId: string, snoozedAtIso: string): Promise<{ woken: boolean }> {
  return currentConversations().wakeSnoozed(conversationId, snoozedAtIso)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function resolve(conversationId: string, by: string, reason?: string): Promise<Conversation> {
  return currentConversations().resolve(conversationId, by, reason)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function reopen(
  conversationId: string,
  by: string,
  trigger: ReopenTrigger = 'staff_reopen',
): Promise<Conversation> {
  return currentConversations().reopen(conversationId, by, trigger)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function reset(conversationId: string, by: string): Promise<Conversation> {
  return currentConversations().reset(conversationId, by)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function reassign(
  conversationId: string,
  assignee: string,
  by: string,
  reason?: string,
): Promise<Conversation> {
  return currentConversations().reassign(conversationId, assignee, by, reason)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function listActivity(conversationId: string): Promise<ActivityEvent[]> {
  return currentConversations().listActivity(conversationId)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function sendText(input: unknown): Promise<unknown> {
  return currentConversations().sendText(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function sendCard(input: unknown): Promise<unknown> {
  return currentConversations().sendCard(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function sendImage(input: unknown): Promise<unknown> {
  return currentConversations().sendImage(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function list(organizationId: string, opts?: ListOpts): Promise<Conversation[]> {
  return currentConversations().list(organizationId, opts)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function listMessagingByContact(
  organizationId: string,
  opts?: Omit<ListOpts, 'tab' | 'contactId'>,
): Promise<{ rows: Conversation[]; counts: { active: number; later: number; done: number } }> {
  return currentConversations().listMessagingByContact(organizationId, opts)
}
