/**
 * contacts module schema.
 *
 * Four tables:
 *   - `contacts` — organization-scoped identity + profile (human) + memory (agent) + attributes
 *   - `contact_attribute_definitions` — org-scoped schema for the `attributes` JSONB
 *   - `contact_external_keys` — per-channel inbound dedup keys → contact_id
 *   - `staff_channel_bindings` — (user_id, channel_instance_id) → external_identifier
 *
 * **Identity vs. external keys.** `contacts.phone` and `contacts.email` carry
 * the contact's canonical wire identity in bare form (E.164 with leading `+`,
 * lowercased RFC email). `contact_external_keys` carries the per-channel
 * inbound dedup key — for phone-keyed channels the value mirrors `phone`, for
 * non-phone-keyed channels (web sessions, etc) it stands alone. Outbound
 * dispatch reads identity off `contacts`; inbound dispatch resolves the
 * contact via `contact_external_keys`. See `service/contacts.ts::upsertByExternalKey`.
 *
 * NOTE: `staff_channel_bindings.channel_instance_id` has a CROSS-SCHEMA FK to
 * `messaging.channel_instances(id)`. That's why push order is `contacts → messaging` —
 * wait, actually staff_channel_bindings references messaging.channel_instances which
 * means messaging must exist FIRST. We resolve via a deferred FK declared with
 * a plain text column here; the FK is enforced by `scripts/db-apply-extras.ts`
 * after `drizzle-kit push` has created both schemas.
 */

import { nanoidPrimaryKey } from '@vobase/core/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { contactsPgSchema } from '~/runtime'

// ─── Domain types ───────────────────────────────────────────────────────────

/** Value type for a single attribute. Narrowed by the matching AttributeDefinition. */
export type AttributeValue = string | number | boolean | null

export interface Contact {
  id: string
  organizationId: string
  displayName: string | null
  phone: string | null
  email: string | null
  /**
   * Human-authored narrative surfaced as virtual file `contact:/PROFILE.md`.
   * Durable identity + standing instructions. Agent reads, never rewrites.
   */
  profile: string
  /**
   * Agent-authored memory surfaced as virtual file `contact:/MEMORY.md`.
   * Rewritten in place by the memory-distill observer.
   */
  memory: string
  /** Dynamic org-defined attributes. Shape declared in `contactAttributeDefinitions`. */
  attributes: Record<string, AttributeValue>
  segments: string[]
  marketingOptOut: boolean
  marketingOptOutAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type AttributeType = 'text' | 'number' | 'boolean' | 'date' | 'enum'

export interface ContactAttributeDefinition {
  id: string
  organizationId: string
  key: string
  label: string
  type: AttributeType
  options: string[]
  showInTable: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface StaffBinding {
  userId: string
  channelInstanceId: string
  externalIdentifier: string
  createdAt: Date
}

export interface ContactExternalKey {
  organizationId: string
  channel: string
  externalKey: string
  contactId: string
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
    profile: text('profile').notNull().default(''),
    memory: text('memory').notNull().default(''),
    attributes: jsonb('attributes').$type<Record<string, AttributeValue>>().notNull().default({}),
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

export const contactAttributeDefinitions = contactsPgSchema.table(
  'contact_attribute_definitions',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull().default('text'),
    options: text('options').array().notNull().default([]),
    showInTable: boolean('show_in_table').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uq_contact_attr_def_org_key').on(t.organizationId, t.key),
    index('idx_contact_attr_def_org').on(t.organizationId),
    check('contact_attr_def_type_check', sql`type IN ('text','number','boolean','date','enum')`),
  ],
)

export const staffChannelBindings = contactsPgSchema.table(
  'staff_channel_bindings',
  {
    userId: text('user_id').notNull(),
    /** FK to messaging.channel_instances(id); enforced post-push in scripts/db-apply-extras.ts */
    channelInstanceId: text('channel_instance_id').notNull(),
    externalIdentifier: text('external_identifier').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelInstanceId] }),
    uniqueIndex('uq_staff_binding_channel_ext').on(t.channelInstanceId, t.externalIdentifier),
  ],
)

/**
 * Per-channel inbound dedup keys. Inbound dispatch resolves the contact by
 * `(organizationId, channel, externalKey)`; outbound dispatch reads identity
 * (phone/email) directly off `contacts`. For phone-keyed channels the
 * `externalKey` mirrors `contacts.phone`; for non-phone channels (web
 * session, future SDKs) it stands alone with `contacts.phone = NULL`.
 *
 * The PK `(organizationId, channel, externalKey)` lets the same identifier
 * appear under different channels without collision (e.g. `+6512345678` on
 * both `whatsapp` and a future `sms` channel — both rows reference the same
 * `contactId` via cross-channel merge).
 */
export const contactExternalKeys = contactsPgSchema.table(
  'contact_external_keys',
  {
    organizationId: text('organization_id').notNull(),
    channel: text('channel').notNull(),
    externalKey: text('external_key').notNull(),
    contactId: text('contact_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.channel, t.externalKey] }),
    index('idx_contact_external_keys_contact').on(t.contactId),
  ],
)

// R1 — compile-time assertion that Drizzle's inferred row shape extends the
// hand-written domain type. Drift surfaces here in `tsc`, not in Phase 2 bugs.
type _ContactAssert =
  InferSelectModel<typeof contacts> extends Omit<Contact, 'segments' | 'memory' | 'profile' | 'attributes'>
    ? true
    : never
type _StaffAssert = InferSelectModel<typeof staffChannelBindings> extends StaffBinding ? true : never
type _AttrDefAssert =
  InferSelectModel<typeof contactAttributeDefinitions> extends Omit<ContactAttributeDefinition, 'type' | 'options'>
    ? true
    : never
type _ExternalKeyAssert = InferSelectModel<typeof contactExternalKeys> extends ContactExternalKey ? true : never
const _contactOk: _ContactAssert = true
const _staffOk: _StaffAssert = true
const _attrDefOk: _AttrDefAssert = true
const _externalKeyOk: _ExternalKeyAssert = true
void _contactOk
void _staffOk
void _attrDefOk
void _externalKeyOk
