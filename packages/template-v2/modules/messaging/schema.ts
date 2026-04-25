/**
 * messaging module schema.
 *
 * Four tables:
 *   - `conversations`
 *   - `messages`
 *   - `internal_notes`
 *   - `pending_approvals`
 *
 * Cross-schema FKs to `contacts.contacts(id)` and `channels.channel_instances(id)`
 * are enforced post-push by `scripts/db-apply-extras.ts`.
 */

// ─── Domain types ───────────────────────────────────────────────────────────

export type ConversationStatus = 'active' | 'resolving' | 'awaiting_approval' | 'resolved' | 'failed'

export interface Conversation {
  id: string
  organizationId: string
  contactId: string
  channelInstanceId: string
  status: ConversationStatus
  assignee: string
  threadKey: string
  emailSubject: string | null
  snoozedUntil: Date | null
  snoozedReason: string | null
  snoozedBy: string | null
  snoozedAt: Date | null
  snoozedJobId: string | null
  lastMessageAt: Date | null
  resolvedAt: Date | null
  resolvedReason: string | null
  createdAt: Date
  updatedAt: Date
  /** Populated only by `ConversationsService.list()` — latest non-system message preview. */
  lastMessagePreview?: string | null
  /** Populated only by `ConversationsService.list()` — kind of latest message. */
  lastMessageKind?: MessageKind | null
  /** Populated only by `ConversationsService.list()` — role of latest message sender. */
  lastMessageRole?: MessageRole | null
  /** Populated only by `ConversationsService.list()`/`get()` — channel instance type (e.g. 'web', 'whatsapp'). */
  channelInstanceType?: string | null
  /** Populated only by `ConversationsService.list()`/`get()` — channel instance display label. */
  channelInstanceLabel?: string | null
}

export type MessageRole = 'customer' | 'agent' | 'system' | 'staff'
export type MessageKind = 'text' | 'image' | 'card' | 'card_reply'

export interface Message {
  id: string
  conversationId: string
  organizationId: string
  role: MessageRole
  kind: MessageKind
  content: unknown
  parentMessageId: string | null
  channelExternalId: string | null
  status: string | null
  createdAt: Date
}

export type InternalNoteAuthorType = 'agent' | 'staff' | 'system'

export interface InternalNote {
  id: string
  organizationId: string
  conversationId: string
  authorType: InternalNoteAuthorType
  authorId: string
  body: string
  mentions: string[]
  parentNoteId: string | null
  notifChannelMsgId: string | null
  notifChannelId: string | null
  createdAt: Date
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface PendingApproval {
  id: string
  organizationId: string
  conversationId: string
  conversationEventId: string | null
  toolName: string
  toolArgs: unknown
  status: ApprovalStatus
  decidedByUserId: string | null
  decidedAt: Date | null
  decidedNote: string | null
  agentSnapshot: unknown
  createdAt: Date
}

// ─── Tables ─────────────────────────────────────────────────────────────────

import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { messagingPgSchema } from '~/runtime'

export const conversations = messagingPgSchema.table(
  'conversations',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    /** Cross-schema FK to contacts.contacts(id); enforced post-push. */
    contactId: text('contact_id').notNull(),
    /** Cross-schema FK to channels.channel_instances(id); enforced post-push. */
    channelInstanceId: text('channel_instance_id').notNull(),
    status: text('status').notNull(),
    assignee: text('assignee').notNull(),
    /**
     * Thread-scoping key. Chat channels (web/whatsapp/telegram/sms) pass
     * `'default'` — one conversation per (organization, contact, channel). Email
     * populates from the RFC 5322 References/In-Reply-To root so each email
     * topic is its own conversation. Stored as text — column is channel-type
     * agnostic; the meaning of the value is owned by the channel adapter.
     */
    threadKey: text('thread_key').notNull().default('default'),
    /** Email-only: subject line of the thread root for list display + search. Null for non-email channels. */
    emailSubject: text('email_subject'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    snoozedReason: text('snoozed_reason'),
    snoozedBy: text('snoozed_by'),
    snoozedAt: timestamp('snoozed_at', { withTimezone: true }),
    snoozedJobId: text('snoozed_job_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedReason: text('resolved_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_conv_organization_status').on(t.organizationId, t.status),
    index('idx_conv_contact').on(t.contactId),
    uniqueIndex('idx_conv_one_per_pair').on(t.organizationId, t.contactId, t.channelInstanceId, t.threadKey),
    index('idx_conv_snoozed').on(t.organizationId, t.snoozedUntil).where(sql`${t.snoozedUntil} IS NOT NULL`),
    check('conversations_status_check', sql`status IN ('active','resolving','awaiting_approval','resolved','failed')`),
  ],
)

export const messages = messagingPgSchema.table(
  'messages',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull(),
    role: text('role').notNull(),
    kind: text('kind').notNull(),
    content: jsonb('content').notNull(),
    parentMessageId: text('parent_message_id'),
    channelExternalId: text('channel_external_id'),
    status: text('status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_msg_conv_ts').on(t.conversationId, t.createdAt),
    uniqueIndex('idx_msg_channel_ext')
      .on(t.organizationId, t.channelExternalId)
      .where(sql`${t.channelExternalId} IS NOT NULL`),
    check('messages_role_check', sql`role IN ('customer','agent','system','staff')`),
    check('messages_kind_check', sql`kind IN ('text','image','card','card_reply')`),
  ],
)

export const internalNotes = messagingPgSchema.table(
  'internal_notes',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorType: text('author_type').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    mentions: text('mentions').array().notNull().default([]),
    parentNoteId: text('parent_note_id'),
    notifChannelMsgId: text('notif_channel_msg_id'),
    /** Cross-schema FK to channels.channel_instances(id); enforced post-push. */
    notifChannelId: text('notif_channel_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notes_conv').on(t.conversationId, t.createdAt),
    index('idx_notes_notif').on(t.notifChannelMsgId).where(sql`${t.notifChannelMsgId} IS NOT NULL`),
    index('idx_notes_mentions').using('gin', t.mentions),
    check('internal_notes_author_type_check', sql`author_type IN ('agent','staff','system')`),
  ],
)

/**
 * Per-user read-state for `@staff:<id>` mentions on internal notes. Row present
 * = dismissed/read. Notification fan-out (T7b) filters unread by `LEFT JOIN`.
 */
export const mentionDismissals = messagingPgSchema.table(
  'mention_dismissals',
  {
    userId: text('user_id').notNull(),
    noteId: text('note_id')
      .notNull()
      .references(() => internalNotes.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_mention_dismissals_user').on(t.userId, t.dismissedAt),
    uniqueIndex('uq_mention_dismissals').on(t.userId, t.noteId),
  ],
)

export interface MentionDismissal {
  userId: string
  noteId: string
  dismissedAt: Date
}

export const pendingApprovals = messagingPgSchema.table(
  'pending_approvals',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    conversationEventId: text('conversation_event_id'),
    toolName: text('tool_name').notNull(),
    toolArgs: jsonb('tool_args').notNull(),
    status: text('status').notNull().default('pending'),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedNote: text('decided_note'),
    agentSnapshot: jsonb('agent_snapshot'),
    /** Scopes B3 per-wake queries from the integration test. */
    wakeId: text('wake_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pending_conv').on(t.conversationId, t.status),
    index('idx_pending_wake').on(t.wakeId).where(sql`${t.wakeId} IS NOT NULL`),
    check('pending_approvals_status_check', sql`status IN ('pending','approved','rejected','expired')`),
  ],
)
