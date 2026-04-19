/**
 * inbox module schema.
 *
 * Five tables:
 *   - `channel_instances` — per-tenant adapter instances (referenced by conversations)
 *   - `conversations`
 *   - `messages`
 *   - `internal_notes`
 *   - `pending_approvals`
 *
 * Cross-schema FKs to `contacts.contacts(id)` and are enforced post-push.
 */

import { inboxPgSchema } from '@server/db/pg-schemas'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const channelInstances = inboxPgSchema.table(
  'channel_instances',
  {
    id: nanoidPrimaryKey(),
    tenantId: text('tenant_id').notNull(),
    type: text('type').notNull(),
    role: text('role').notNull().default('customer'),
    displayName: text('display_name'),
    config: jsonb('config').notNull().default({}),
    webhookSecret: text('webhook_secret'),
    status: text('status').default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_channel_instances_tenant').on(t.tenantId),
    check('channel_instances_role_check', sql`role IN ('customer','staff')`),
  ],
)

export const conversations = inboxPgSchema.table(
  'conversations',
  {
    id: nanoidPrimaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Cross-schema FK to contacts.contacts(id); enforced post-push. */
    contactId: text('contact_id').notNull(),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id, { onDelete: 'restrict' }),
    parentConversationId: text('parent_conversation_id'),
    compactionSummary: text('compaction_summary'),
    compactedAt: timestamp('compacted_at', { withTimezone: true }),
    status: text('status').notNull(),
    assignee: text('assignee').notNull(),
    onHold: boolean('on_hold').default(false),
    onHoldReason: text('on_hold_reason'),
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
    index('idx_conv_tenant_status').on(t.tenantId, t.status),
    index('idx_conv_contact').on(t.contactId),
    index('idx_conv_parent').on(t.parentConversationId),
    check(
      'conversations_status_check',
      sql`status IN ('active','resolving','resolved','compacted','archived','awaiting_approval','failed')`,
    ),
  ],
)

export const messages = inboxPgSchema.table(
  'messages',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
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
      .on(t.tenantId, t.channelExternalId)
      .where(sql`${t.channelExternalId} IS NOT NULL`),
    check('messages_role_check', sql`role IN ('customer','agent','system','staff')`),
    check('messages_kind_check', sql`kind IN ('text','image','card','card_reply')`),
  ],
)

export const internalNotes = inboxPgSchema.table(
  'internal_notes',
  {
    id: nanoidPrimaryKey(),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorType: text('author_type').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    mentions: text('mentions').array().notNull().default([]),
    parentNoteId: text('parent_note_id'),
    notifChannelMsgId: text('notif_channel_msg_id'),
    notifChannelId: text('notif_channel_id').references(() => channelInstances.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notes_conv').on(t.conversationId, t.createdAt),
    index('idx_notes_notif').on(t.notifChannelMsgId).where(sql`${t.notifChannelMsgId} IS NOT NULL`),
    check('internal_notes_author_type_check', sql`author_type IN ('agent','staff','system')`),
  ],
)

export const pendingApprovals = inboxPgSchema.table(
  'pending_approvals',
  {
    id: nanoidPrimaryKey(),
    tenantId: text('tenant_id').notNull(),
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
