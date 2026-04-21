/**
 * contacts module schema.
 *
 * Two tables:
 *   - `contacts` — organization-scoped identity (phone/email + working memory + segments)
 *   - `staff_channel_bindings` — (user_id, channel_instance_id) → external_identifier
 *
 * NOTE: `staff_channel_bindings.channel_instance_id` has a CROSS-SCHEMA FK to
 * `inbox.channel_instances(id)`. That's why push order is `contacts → inbox` —
 * wait, actually staff_channel_bindings references inbox.channel_instances which
 * means inbox must exist FIRST. We resolve via a deferred FK declared with
 * a plain text column here; the FK is enforced by `scripts/db-apply-extras.ts`
 * after `drizzle-kit push` has created both schemas.
 */

import { contactsPgSchema } from '@server/db/pg-schemas'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { boolean, index, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// ─── Domain types ───────────────────────────────────────────────────────────

export interface Contact {
  id: string
  organizationId: string
  displayName: string | null
  phone: string | null
  email: string | null
  workingMemory: string
  segments: string[]
  marketingOptOut: boolean
  marketingOptOutAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface StaffBinding {
  userId: string
  channelInstanceId: string
  externalIdentifier: string
  createdAt: Date
}

export const contacts = contactsPgSchema.table(
  'contacts',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    displayName: text('display_name'),
    phone: text('phone'),
    email: text('email'),
    workingMemory: text('working_memory').notNull().default(''),
    segments: text('segments').array().notNull().default([]),
    marketingOptOut: boolean('marketing_opt_out').notNull().default(false),
    marketingOptOutAt: timestamp('marketing_opt_out_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_contacts_organization').on(t.organizationId),
    uniqueIndex('uq_contacts_tenant_phone').on(t.organizationId, t.phone),
    uniqueIndex('uq_contacts_tenant_email').on(t.organizationId, t.email),
  ],
)

export const staffChannelBindings = contactsPgSchema.table(
  'staff_channel_bindings',
  {
    userId: text('user_id').notNull(),
    /** FK to inbox.channel_instances(id); enforced post-push in scripts/db-apply-extras.ts */
    channelInstanceId: text('channel_instance_id').notNull(),
    externalIdentifier: text('external_identifier').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelInstanceId] }),
    uniqueIndex('uq_staff_binding_channel_ext').on(t.channelInstanceId, t.externalIdentifier),
  ],
)

// R1 — compile-time assertion that Drizzle's inferred row shape extends the
// hand-written domain type. Drift surfaces here in `tsc`, not in Phase 2 bugs.
type _ContactAssert =
  InferSelectModel<typeof contacts> extends Omit<Contact, 'segments' | 'workingMemory'> ? true : never
type _StaffAssert = InferSelectModel<typeof staffChannelBindings> extends StaffBinding ? true : never
const _contactOk: _ContactAssert = true
const _staffOk: _StaffAssert = true
void _contactOk
void _staffOk
