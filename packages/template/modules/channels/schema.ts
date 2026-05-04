/**
 * channels module schema.
 *
 * Two tables:
 *   - `channels` — static registry: per-name capability + enabled flag, populated lazily.
 *   - `channel_instances` — per-organization adapter instances. Lives here because
 *     the channels umbrella owns the cross-channel admin page and dispatch surface.
 *
 * Cross-schema FKs to `channels.channel_instances(id)` are declared in
 * `messaging.conversations`, `messaging.internal_notes`, and
 * `contacts.staff_channel_bindings` — all enforced post-push by
 * `scripts/db-apply-extras.ts` because drizzle-kit can't express cross-schema
 * `.references()`.
 */

import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, text, timestamp } from 'drizzle-orm/pg-core'

import { channelsPgSchema } from '~/runtime'

// ─── Domain types ───────────────────────────────────────────────────────────

export type ChannelInstanceRole = 'customer' | 'staff'

export interface ChannelInstance {
  id: string
  organizationId: string
  channel: string
  role: ChannelInstanceRole
  displayName: string | null
  config: Record<string, unknown>
  webhookSecret: string | null
  status: string | null
  setupStage: string | null
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ChannelRegistryRow {
  id: string
  name: string
  enabled: boolean
  capabilities: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

// ─── Tables ─────────────────────────────────────────────────────────────────

/**
 * Static per-channel registry. Populated lazily from the in-process
 * `service/registry.ts` cache so the admin UI can render channels that have no
 * instances yet. The runtime registry is the source of truth; this table is a
 * UI-friendly mirror.
 */
export const channels = channelsPgSchema.table('channels', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
  capabilities: jsonb('capabilities'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const channelInstances = channelsPgSchema.table(
  'channel_instances',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    /** Discriminator — must match a registered name in `service/registry.ts`. */
    channel: text('channel').notNull(),
    /** `customer` for inbound channels, `staff` for staff-notification routing. */
    role: text('role').notNull().$type<ChannelInstanceRole>().default('customer'),
    displayName: text('display_name'),
    /** Adapter-specific config (validated by the adapter's own Zod schema). */
    config: jsonb('config').notNull().$type<Record<string, unknown>>().default({}),
    /** HMAC shared secret for inbound webhook verification (channels that opt in). */
    webhookSecret: text('webhook_secret'),
    status: text('status').default('active'),
    /** Multi-step setup state (e.g. WhatsApp embedded signup). */
    setupStage: text('setup_stage'),
    /** Last setup/dispatch error surfaced to the admin UI. */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_channel_instances_organization').on(t.organizationId),
    index('idx_channel_instances_channel').on(t.channel),
    check('channel_instances_role_check', sql`role IN ('customer','staff')`),
  ],
)

/**
 * Per-conversation 24-hour service window tracking for WhatsApp (and future)
 * channels with `capabilities.messagingWindow = true`.
 * Single-writer: `messaging/service/sessions.ts`.
 * Cross-schema FK to `messaging.conversations(id)` enforced post-push.
 */
export const conversationSessions = channelsPgSchema.table(
  'conversation_sessions',
  {
    /** Cross-schema FK to messaging.conversations(id); enforced post-push. */
    conversationId: text('conversation_id').primaryKey(),
    /** Cross-schema FK to channels.channel_instances(id); enforced post-push. */
    channelInstanceId: text('channel_instance_id').notNull(),
    sessionState: text('session_state').notNull().default('open'),
    windowOpenedAt: timestamp('window_opened_at', { withTimezone: true }).notNull(),
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('idx_conv_sessions_expires').on(t.windowExpiresAt)],
)

export interface ConversationSession {
  conversationId: string
  channelInstanceId: string
  sessionState: string
  windowOpenedAt: Date
  windowExpiresAt: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * CSRF nonce store for WhatsApp Embedded Signup flow.
 * Single-writer: `channels/adapters/whatsapp/handlers/signup.ts`.
 */
export const signupNonces = channelsPgSchema.table('signup_nonces', {
  nonce: text('nonce').primaryKey(),
  organizationId: text('organization_id').notNull(),
  sessionId: text('session_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export interface SignupNonce {
  nonce: string
  organizationId: string
  sessionId: string
  expiresAt: Date
}
