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
import { emit } from '@modules/automations/service/events'
import { channelInstances } from '@modules/channels/schema'
import { filesServiceFor } from '@modules/drive/service/files'
import type { MessageAttachmentRef } from '@modules/drive/service/types'
import { conversationEvents } from '@vobase/core'
import { and, desc, eq, getTableColumns, gt, inArray, isNotNull, or, sql } from 'drizzle-orm'

import type { Tx } from '~/runtime'
import { type Conversation, conversations, type Message, messages } from '../schema'
import { transitionConversation } from '../state'
import { computeTab } from './bucketing'
import type {
  AttachHistoricalMediaInput,
  AttachHistoricalMediaResult,
  BackfillHistoryInput,
  BackfillHistoryResult,
  CreateConversationInput,
  CreateInboundMessageInput,
  CreateInboundMessageResult,
  ResolveImportedHistoryInput,
  ResolveImportedHistoryResult,
} from './types'

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

/** Escape hatch for a grouped `innerJoin` aggregate — not representable via DbHandle. */
type GroupedJoinSelectChain = {
  from: (t: unknown) => {
    innerJoin: (
      table: unknown,
      on: unknown,
    ) => {
      where: (c: unknown) => { groupBy: (col: unknown) => Promise<unknown[]> }
    }
  }
}
type DbWithGroupedJoin = { select: (fields: unknown) => GroupedJoinSelectChain }

/**
 * Detect a Postgres unique-violation (SQLSTATE 23505) on the
 * `idx_msg_channel_ext` partial unique index. We match by SQLSTATE first
 * (postgres-js surfaces the code as `code` on the thrown error) and fall
 * back to constraint-name detection so e2e harnesses that re-throw a
 * narrowed error still trip the loser-of-race path.
 */
function isUniqueViolationOnExternalId(err: unknown): boolean {
  // Walk an error chain (drizzle wraps postgres-js errors via `.cause`),
  // matching either by SQLSTATE 23505 or by the partial-unique-index name.
  let cur: unknown = err
  for (let depth = 0; depth < 4 && cur; depth++) {
    if (typeof cur !== 'object') return false
    const e = cur as { code?: string; constraint_name?: string; constraint?: string; message?: string; cause?: unknown }
    if (e.code === '23505') return true
    const constraint = e.constraint_name ?? e.constraint
    if (constraint === 'idx_msg_channel_ext') return true
    if (typeof e.message === 'string' && e.message.includes('idx_msg_channel_ext')) return true
    cur = e.cause
  }
  return false
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

/**
 * Coexistence history-import audit events — emitted ONCE PER affected
 * conversation (not per message) by `backfillHistoricalMessages` /
 * `resolveImportedHistory`, so the bulk import still honors the "every
 * conversation-scoped mutation appends conversation_events" doctrine at
 * O(threads) instead of O(messages).
 */
export const HISTORY_IMPORTED_EVENT = 'conversation.history_imported'
export const HISTORY_RESOLVED_EVENT = 'conversation.history_resolved'

export const TIMELINE_ACTIVITY_TYPES = [
  'conversation.reassigned',
  'conversation.resolved',
  'conversation.reopened',
  'conversation.snoozed',
  'conversation.unsnoozed',
  'conversation.snooze_expired',
  // Coexistence history-import lifecycle (modules/channels history drain).
  HISTORY_IMPORTED_EVENT,
  HISTORY_RESOLVED_EVENT,
  'conversation.owner_changed',
  // Change-proposal lifecycle events. Emitted by `modules/changes/service/proposals.ts`
  // when the affected proposal is conversation-scoped (i.e. `conversationId` set
  // — the workspace-sync observer threads this through from the wake context).
  // Renders in the inbox timeline as a one-line activity row with click-through
  // to the full proposal in the inbox.
  'change.proposed',
  'change.auto_applied',
  'change.approved',
  'change.rejected',
  // Staff-ping notification events. Emitted by `modules/messaging/service/notification-events.ts`
  // when the team module dispatches (or suppresses) a WhatsApp/email ping for
  // a mention/approval/proposal. Renders as "Pinged {staff} via {channel}" /
  // "Skipped ping to {staff} ({reason})". `admin_alert` kind never has a
  // conversationId and is therefore never journaled to a timeline.
  'notification.sent',
  'notification.suppressed',
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
  backfillHistoricalMessages(input: BackfillHistoryInput): Promise<BackfillHistoryResult>
  resolveImportedHistory(input: ResolveImportedHistoryInput): Promise<ResolveImportedHistoryResult>
  attachHistoricalMedia(input: AttachHistoricalMediaInput): Promise<AttachHistoricalMediaResult>
  /**
   * Set (or clear, with `null`) the conversation's owner — the staff member in
   * charge. Independent of `assignee`; does NOT silence the agent. `by` is the
   * `agent:<id>` / `user:<id>` actor for the journal entry.
   */
  setOwner(conversationId: string, ownerUserId: string | null, by: string): Promise<Conversation>
  /**
   * For each `userId`, the most recent `ownerAssignedAt` across the org's
   * conversations (null when never assigned). Backs round-robin least-recently-assigned.
   */
  lastOwnerAssignedAt(organizationId: string, userIds: string[]): Promise<Map<string, Date | null>>
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

  async function _createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult> {
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

    // Idempotency-first (Principle 8). Check `messages.channel_external_id`
    // BEFORE doing any drive ingest. Concurrent webhook redeliveries (WA
    // retries 5xx) hit this gate; the second observer sees the first's row
    // and exits without producing duplicate drive rows or duplicate OCR cost.
    const existing = (await db
      .select()
      .from(messages)
      .where(
        and(eq(messages.organizationId, input.organizationId), eq(messages.channelExternalId, input.externalMessageId)),
      )
      .limit(1)) as Message[]

    if (existing[0]) return { conversation, message: existing[0], isNew: false }

    // Pre-ingest driveFiles BEFORE opening the message tx. Failures (e.g.
    // storage upload exceptions) are warn-logged and the offending
    // attachment is dropped; the message itself still posts. The driveFile
    // row is left in `(failed, failed)` for audit. See `Step 12 — Failure
    // modes` in `.omc/plans/drive-upload-ocr-extraction.md`.
    const attachmentRefs: MessageAttachmentRef[] = []
    const ingestedFileIds: string[] = []
    if (input.attachments && input.attachments.length > 0) {
      const drive = filesServiceFor(input.organizationId)
      for (const att of input.attachments) {
        try {
          const ingest = await drive.ingestUpload({
            organizationId: input.organizationId,
            scope: { scope: 'contact', contactId: input.contactId },
            originalName: att.name,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            bytes: att.bytes,
            source: 'customer_inbound',
            uploadedBy: null,
            // Scope-relative basePath: contact-scope rows store paths like
            // `/attachments/<file>` (not `/contacts/<id>/attachments/<file>`)
            // so the contact-details drive view nests them under a real
            // `attachments/` folder row rather than dumping the literal
            // absolute path string at scope root.
            basePath: '/attachments/',
          })
          ingestedFileIds.push(ingest.id)
          attachmentRefs.push({
            driveFileId: ingest.id,
            // Denormalize the bash-view path so the agent's wake cue and the
            // staff-inbox renderer get a directly-usable path (the DB row
            // stores the scope-relative `/attachments/<file>`).
            path: `/contacts/${input.contactId}/drive${ingest.path}`,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            name: att.name,
            caption: null,
            extractionKind: ingest.extractionKind,
          })
        } catch (err) {
          console.warn('[messaging:inbound] attachment ingest failed; omitting from message', {
            externalMessageId: input.externalMessageId,
            name: att.name,
            err: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    const kind = input.contentType === 'image' ? 'image' : 'text'
    let txOutcome: { message: Message; nextConversation: Conversation; cancelJobId: string | null }
    try {
      txOutcome = await db.transaction(async (tx) => {
        const msgRows = (await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            organizationId: input.organizationId,
            role: input.role ?? 'customer',
            kind,
            content: { text: input.content },
            channelExternalId: input.externalMessageId,
            attachments: attachmentRefs,
            metadata: input.metadata ?? {},
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
    } catch (err) {
      // Loser-of-race (Step 12 step 3): a concurrent webhook redelivery
      // committed its message between our existence check and our insert.
      // Reap our own just-ingested drive rows and observe the winner.
      if (isUniqueViolationOnExternalId(err)) {
        if (ingestedFileIds.length > 0) {
          try {
            const drive = filesServiceFor(input.organizationId)
            await drive.reapIngestedFiles(ingestedFileIds)
          } catch (reapErr) {
            console.warn('[messaging:inbound] reap-on-loss failed; orphan drive rows possible', {
              externalMessageId: input.externalMessageId,
              ingestedFileIds,
              err: reapErr instanceof Error ? reapErr.message : String(reapErr),
            })
          }
        }
        const winner = (await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.organizationId, input.organizationId),
              eq(messages.channelExternalId, input.externalMessageId),
            ),
          )
          .limit(1)) as Message[]
        if (winner[0]) return { conversation, message: winner[0], isNew: false }
      }
      throw err
    }

    const { message, nextConversation, cancelJobId } = txOutcome

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

      // US-008 (Slice B.3): notify the automations dispatcher that the
      // conversation has changed hands. Inside the tx so a rollback would
      // also drop the event row (the wake should never fire for a reassignment
      // that never persisted).
      await emit(
        'conversation_reassigned',
        {
          conversationId,
          organizationId: row.organizationId,
          fromAssignee: current.assignee ?? null,
          toAssignee: assignee,
          ...(reason ? { reason } : {}),
        },
        { tx: tx as unknown as Tx },
      )
      return row
    })
  }

  async function setOwner(conversationId: string, ownerUserId: string | null, by: string): Promise<Conversation> {
    const current = await get(conversationId)
    // No-op guard — re-setting the current owner (a retried request, a staff
    // member re-picking the same person) must not write a junk journal row or
    // fire a spurious realtime invalidation.
    if (current.ownerUserId === ownerUserId) return current
    return db.transaction(async (tx) => {
      const rows = (await tx
        .update(conversations)
        .set({
          ownerUserId,
          // Stamp the assignment time on set; clear it when the owner is removed.
          ownerAssignedAt: ownerUserId ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId))
        .returning()) as Conversation[]
      const row = rows[0]
      if (!row) throw new Error(`messaging/conversations.setOwner: not found: ${conversationId}`)

      await writeConversationEvent(tx, {
        conversationId,
        organizationId: row.organizationId,
        type: 'conversation.owner_changed',
        payload: { from: current.ownerUserId ?? null, to: ownerUserId, by },
      })
      // No `emit(...)` here — an owner change is not a hand-off of the
      // responder seat and must never wake the agent (that stays gated on
      // `assignee`). The journal row is enough for the inbox timeline.
      return row
    })
  }

  async function lastOwnerAssignedAt(organizationId: string, userIds: string[]): Promise<Map<string, Date | null>> {
    const result = new Map<string, Date | null>()
    for (const id of userIds) result.set(id, null)
    if (userIds.length === 0) return result

    // No SQL GROUP BY — the minimal DbHandle select chain doesn't expose it.
    // Owner-assigned conversations are few per rep; fold the MAX in JS.
    const rows = (await db
      .select({
        ownerUserId: conversations.ownerUserId,
        ownerAssignedAt: conversations.ownerAssignedAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          inArray(conversations.ownerUserId, userIds),
          isNotNull(conversations.ownerAssignedAt),
        ),
      )) as unknown as Array<{ ownerUserId: string | null; ownerAssignedAt: Date | null }>
    for (const r of rows) {
      if (!r.ownerUserId || !r.ownerAssignedAt) continue
      const prev = result.get(r.ownerUserId)
      if (!prev || r.ownerAssignedAt > prev) result.set(r.ownerUserId, r.ownerAssignedAt)
    }
    return result
  }

  /**
   * Backfill imported WhatsApp coexistence history into the contact's
   * conversation. Resume-or-create as ACTIVE + unassigned so the imported
   * thread surfaces directly in the inbox (a later live inbound just appends).
   * Messages are written with their original `createdAt`, idempotent on the
   * WhatsApp message id, and DELIBERATELY suppress the live inbound
   * side-effects — no 24h window, no agent wake, no automations, no staff-note
   * fan-out, no per-message realtime notify.
   */
  async function backfillHistoricalMessages(input: BackfillHistoryInput): Promise<BackfillHistoryResult> {
    const threadKey = input.threadKey ?? 'default'

    const insertedConv = (await db
      .insert(conversations)
      .values({
        organizationId: input.organizationId,
        contactId: input.contactId,
        channelInstanceId: input.channelInstanceId,
        status: 'active',
        assignee: 'unassigned',
        threadKey,
      })
      .onConflictDoNothing()
      .returning()) as Conversation[]
    let conversation = insertedConv[0]
    // `history_imported` is written once, only when THIS call creates the
    // conversation — a pre-existing live thread that merely gets history
    // appended is not an "imported" conversation.
    const created = Boolean(conversation)
    if (!conversation) {
      const rows = (await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.organizationId, input.organizationId),
            eq(conversations.contactId, input.contactId),
            eq(conversations.channelInstanceId, input.channelInstanceId),
            eq(conversations.threadKey, threadKey),
          ),
        )
        .limit(1)) as Conversation[]
      conversation = rows[0]
      if (!conversation) {
        throw new Error('messaging/conversations.backfillHistoricalMessages: no conversation after upsert')
      }
    }

    if (input.messages.length === 0) {
      if (created) {
        await writeConversationEvent(db, {
          conversationId: conversation.id,
          organizationId: input.organizationId,
          type: HISTORY_IMPORTED_EVENT,
          payload: { source: 'whatsapp_coexistence', inserted: 0 },
        })
      }
      return { conversationId: conversation.id, inserted: 0, skipped: 0 }
    }

    // A 180-day history burst can carry thousands of messages per thread, so the
    // dedup lookup and the insert are batched to stay well under Postgres's
    // ~65k bind-parameter ceiling and to bound peak memory.
    const DEDUP_BATCH = 1000
    const INSERT_BATCH = 500

    // Idempotency on the WhatsApp message id (org-scoped), mirroring inbound.
    const wamids = input.messages.map((m) => m.wamid)
    const seen = new Set<string | null>()
    for (let i = 0; i < wamids.length; i += DEDUP_BATCH) {
      const batch = wamids.slice(i, i + DEDUP_BATCH)
      const existingRows = (await db
        .select({ channelExternalId: messages.channelExternalId })
        .from(messages)
        .where(and(eq(messages.organizationId, input.organizationId), inArray(messages.channelExternalId, batch)))
        .limit(batch.length)) as Array<{ channelExternalId: string | null }>
      for (const r of existingRows) seen.add(r.channelExternalId)
    }
    const toInsert = input.messages.filter((m) => !seen.has(m.wamid))

    if (toInsert.length === 0) {
      return { conversationId: conversation.id, inserted: 0, skipped: input.messages.length }
    }

    const conversationId = conversation.id

    // Bump lastMessageAt to the latest historical time without regressing a
    // newer value a live message may already have set.
    let maxOccurredAt = toInsert[0].occurredAt
    for (const m of toInsert) {
      if (m.occurredAt > maxOccurredAt) maxOccurredAt = m.occurredAt
    }
    const nextLastMessageAt =
      conversation.lastMessageAt && conversation.lastMessageAt > maxOccurredAt
        ? conversation.lastMessageAt
        : maxOccurredAt

    // Insert all messages + bump the conversation atomically, so a mid-burst
    // failure can't leave a half-written backfill (a retry stays safe via the
    // wamid idempotency above).
    await db.transaction(async (tx) => {
      for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
        const batch = toInsert.slice(i, i + INSERT_BATCH)
        await tx.insert(messages).values(
          batch.map((m) => ({
            conversationId,
            organizationId: input.organizationId,
            role: m.role,
            kind: m.contentType === 'image' ? 'image' : 'text',
            content: { text: m.content },
            channelExternalId: m.wamid,
            createdAt: m.occurredAt,
            metadata: { ...(m.metadata ?? {}), historical: true },
          })),
        )
      }
      await tx
        .update(conversations)
        .set({ lastMessageAt: nextLastMessageAt, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
      // One audit event per imported conversation, in the same tx as its
      // messages (O(threads), not O(messages)).
      if (created) {
        await writeConversationEvent(tx, {
          conversationId,
          organizationId: input.organizationId,
          type: HISTORY_IMPORTED_EVENT,
          payload: { source: 'whatsapp_coexistence', inserted: toInsert.length },
        })
      }
    })

    return {
      conversationId,
      inserted: toInsert.length,
      skipped: input.messages.length - toInsert.length,
    }
  }

  /**
   * Bulk-resolve conversations backfilled from coexistence history sync so a
   * 6-month import doesn't flood the live inbox with dead threads. Only touches
   * "pure history" conversations on the instance — every message historical and
   * the thread still `active` (threads with no messages are never scanned, via
   * the inner join) — so it never resolves a live conversation. A thread whose
   * most recent message is an inbound customer message within `keepActiveWindowMs`
   * is left `active` (a genuinely-open ticket worth triaging at onboarding);
   * everything else → `resolved` (reason `history_import`, `resolvedAt` = the
   * thread's last historical message time).
   *
   * Non-destructive + idempotent: a resolved thread auto-reopens to `active` on
   * the next live inbound (see `_createInboundMessage`), and the write re-checks
   * `status = 'active'` + still-pure-history, so re-runs skip already-resolved
   * rows and a concurrent live inbound can't be buried.
   *
   * AUDIT NOTE: this is the one conversation mutation that does NOT append a
   * per-thread `conversation_events` row — a deliberate exception for a bulk
   * onboarding op where N can be thousands and per-row timeline events would be
   * pure noise. The action stays auditable in aggregate via
   * `status = 'resolved' AND resolvedReason = 'history_import'`.
   */
  async function resolveImportedHistory(input: ResolveImportedHistoryInput): Promise<ResolveImportedHistoryResult> {
    const windowMs = input.keepActiveWindowMs ?? 7 * 24 * 60 * 60 * 1000
    const cutoff = new Date((input.now ?? new Date()).getTime() - windowMs)

    // One grouped pass over the instance's still-active threads: per conversation
    // the latest message time, the latest *customer* message time, and whether
    // every message is historical. `lastAt === lastCustomerAt` ⇒ the most recent
    // message is the customer's. `coalesce(..., false)` makes a message with no
    // `historical` flag count as live, so a half-live thread is never "pure".
    const rows = (await (db as unknown as DbWithGroupedJoin)
      .select({
        conversationId: messages.conversationId,
        lastAt: sql<string>`max(${messages.createdAt})`,
        lastCustomerAt: sql<string | null>`max(${messages.createdAt}) filter (where ${messages.role} = 'customer')`,
        allHistorical: sql<boolean>`bool_and(coalesce((${messages.metadata} ->> 'historical') = 'true', false))`,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(conversations.organizationId, input.organizationId),
          eq(conversations.channelInstanceId, input.channelInstanceId),
          eq(conversations.status, 'active'),
        ),
      )
      .groupBy(messages.conversationId)) as Array<{
      conversationId: string
      lastAt: string
      lastCustomerAt: string | null
      allHistorical: boolean
    }>

    const pureHistory = rows.filter((r) => r.allHistorical)
    const toResolve: string[] = []
    let keptActive = 0
    for (const r of pureHistory) {
      // Compare via epoch ms (not raw timestamp strings) so driver/format quirks
      // can't break the tie check. On an exact tie (a customer + staff message at
      // the same second — reachable with second-granularity backfill timestamps)
      // the thread is kept active: there is still an unanswered customer message
      // at the tip.
      const lastIsCustomer =
        r.lastCustomerAt !== null && new Date(r.lastCustomerAt).getTime() === new Date(r.lastAt).getTime()
      const recent = new Date(r.lastAt).getTime() >= cutoff.getTime()
      if (lastIsCustomer && recent) keptActive += 1
      else toResolve.push(r.conversationId)
    }

    if (toResolve.length === 0) return { scanned: pureHistory.length, resolved: 0, keptActive }

    // Validate the edge through the FSM once (uniform active → resolved), then
    // apply set-based, but in id-batches so a large import (thousands of dead
    // threads) never blows Postgres's bind-parameter ceiling on the `inArray`.
    // Each batch's WHERE re-asserts `status='active'` and still-pure history at
    // write time, so a live inbound that raced the SELECT excludes the thread
    // here rather than burying the new message in a resolved conversation —
    // batching doesn't weaken that guard, and resolution stays idempotent +
    // retryable. resolvedAt reuses the stored last-message time (coalesced for
    // safety) so the timeline reads naturally; `returning` gives the true count.
    const RESOLVE_BATCH = 1000
    const resolvedStatus = transitionConversation('active', 'resolved')
    let resolved = 0
    for (let i = 0; i < toResolve.length; i += RESOLVE_BATCH) {
      const ids = toResolve.slice(i, i + RESOLVE_BATCH)
      await db.transaction(async (tx) => {
        const updated = (await tx
          .update(conversations)
          .set({
            status: resolvedStatus,
            resolvedReason: 'history_import',
            resolvedAt: sql`coalesce(${conversations.lastMessageAt}, now())`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(conversations.id, ids),
              eq(conversations.status, 'active'),
              sql`not exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id} and coalesce((${messages.metadata} ->> 'historical') = 'true', false) = false)`,
            ),
          )
          .returning()) as Conversation[]
        if (updated.length > 0) {
          // One audit event per resolved conversation, in the same tx as the
          // status change. A re-run resolves nothing (the WHERE excludes
          // already-resolved rows), so these events never duplicate.
          await tx.insert(conversationEvents).values(
            updated.map((c) => ({
              conversationId: c.id,
              organizationId: input.organizationId,
              wakeId: null,
              turnIndex: 0,
              type: HISTORY_RESOLVED_EVENT,
              payload: { reason: 'history_import' },
            })),
          )
        }
        resolved += updated.length
      })
    }

    return { scanned: pureHistory.length, resolved, keptActive }
  }

  /**
   * Enrich an imported-history `media_placeholder` message with its downloaded
   * media. Reuses the live-inbound attachment path: `drive.ingestUpload` then a
   * `MessageAttachmentRef` on the message, so the existing renderer shows it.
   * Matched by the WhatsApp message id; returns `found:false` when the
   * placeholder isn't created yet so the caller can retry (the asset webhook can
   * arrive before its history chunk is drained).
   */
  async function attachHistoricalMedia(input: AttachHistoricalMediaInput): Promise<AttachHistoricalMediaResult> {
    const rows = (await db
      .select()
      .from(messages)
      .where(and(eq(messages.organizationId, input.organizationId), eq(messages.channelExternalId, input.wamid)))
      .limit(1)) as Message[]
    const msg = rows[0]
    if (!msg) return { found: false, updated: false }
    if ((msg.attachments ?? []).length > 0) return { found: true, updated: false }

    const convRows = (await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, msg.conversationId))
      .limit(1)) as Conversation[]
    const conv = convRows[0]
    if (!conv) return { found: true, updated: false }

    const drive = filesServiceFor(input.organizationId)
    const ingest = await drive.ingestUpload({
      organizationId: input.organizationId,
      scope: { scope: 'contact', contactId: conv.contactId },
      originalName: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      bytes: input.bytes,
      source: 'customer_inbound',
      uploadedBy: null,
      basePath: '/attachments/',
    })
    const attachment: MessageAttachmentRef = {
      driveFileId: ingest.id,
      // Denormalize the bash-view path so the agent's wake cue and the
      // staff-inbox renderer get a directly-usable path (the DB row stores the
      // scope-relative `/attachments/<file>`).
      path: `/contacts/${conv.contactId}/drive${ingest.path}`,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      name: input.filename,
      caption: null,
      extractionKind: ingest.extractionKind,
    }
    await db
      .update(messages)
      .set({ kind: input.mimeType.startsWith('image/') ? 'image' : 'text', attachments: [attachment] })
      .where(eq(messages.id, msg.id))
    return { found: true, updated: true }
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
    createInboundMessage: _createInboundMessage,
    snooze,
    unsnooze,
    wakeSnoozed,
    resolve,
    reopen,
    reset,
    reassign,
    backfillHistoricalMessages,
    resolveImportedHistory,
    attachHistoricalMedia,
    setOwner,
    lastOwnerAssignedAt,
    listActivity,
    list,
    listMessagingByContact,
    sendText,
    sendCard,
    sendImage,
  }
}

/**
 * Resolve a conversation's `contactId` from its id. Used by cross-module
 * callers (team staff-ping, automations dispatcher) that build deep links into
 * the inbox — the conversation-detail route is keyed by contactId, not
 * conversationId. Returns null when the conversation row doesn't exist.
 */
export async function getConversationContactId(db: unknown, conversationId: string): Promise<string | null> {
  const rows = (await (db as DbHandle)
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)) as Array<{ contactId: string }>
  return rows[0]?.contactId ?? null
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
export async function backfillHistoricalMessages(input: BackfillHistoryInput): Promise<BackfillHistoryResult> {
  return currentConversations().backfillHistoricalMessages(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function resolveImportedHistory(
  input: ResolveImportedHistoryInput,
): Promise<ResolveImportedHistoryResult> {
  return currentConversations().resolveImportedHistory(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function attachHistoricalMedia(input: AttachHistoricalMediaInput): Promise<AttachHistoricalMediaResult> {
  return currentConversations().attachHistoricalMedia(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function setOwner(conversationId: string, ownerUserId: string | null, by: string): Promise<Conversation> {
  return currentConversations().setOwner(conversationId, ownerUserId, by)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function lastOwnerAssignedAt(
  organizationId: string,
  userIds: string[],
): Promise<Map<string, Date | null>> {
  return currentConversations().lastOwnerAssignedAt(organizationId, userIds)
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
