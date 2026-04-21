/**
 * team module schema.
 *
 * Two tables in the `team` pgSchema:
 *   - `staff_profiles` — per-user domain profile (sectors, expertise, capacity,
 *     availability, attributes, plus a `profile` narrative (human-authored,
 *     routing hints) and `notes` markdown (agent-authored, distilled memory).
 *   - `staff_attribute_definitions` — org-scoped schema for the `attributes` JSONB
 *     (clone of `contact_attribute_definitions`).
 *
 * Identity / auth / team-membership live in better-auth (`auth.user`,
 * `auth.member`, `auth.team_member`). Channel identities live in
 * `contacts.staff_channel_bindings`. The `profile` / `notes` columns are
 * surfaced as virtual `/PROFILE.md` + `/NOTES.md` files under Drive
 * `scope='staff'` (mirrors the contact-scope overlay).
 */

import { teamPgSchema } from '@server/db/pg-schemas'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// ─── Domain types ───────────────────────────────────────────────────────────

export type AttributeValue = string | number | boolean | null
export type AttributeType = 'text' | 'number' | 'boolean' | 'date' | 'enum'
export type Availability = 'active' | 'busy' | 'off' | 'inactive'

export interface StaffProfile {
  userId: string
  organizationId: string
  displayName: string | null
  title: string | null
  sectors: string[]
  expertise: string[]
  languages: string[]
  capacity: number
  availability: Availability
  attributes: Record<string, AttributeValue>
  /**
   * Human-authored narrative (routing hints, Mandarin-first, OOO Fridays, etc.).
   * Mirrors `contacts.profile`. Surfaced as `staff:/PROFILE.md` in Drive.
   */
  profile: string
  /**
   * Agent-authored distilled memory markdown. Rewritten section-by-section by
   * the memory-distill observer. Mirrors `contacts.notes`. Surfaced as
   * `staff:/NOTES.md` in Drive.
   */
  notes: string
  /** Heartbeat for presence / offline detection (mentions notification flow). */
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface TeamDescription {
  teamId: string
  organizationId: string
  description: string
  updatedAt: Date
}

export interface StaffAttributeDefinition {
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

export const staffProfiles = teamPgSchema.table(
  'staff_profiles',
  {
    userId: text('user_id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    displayName: text('display_name'),
    title: text('title'),
    sectors: text('sectors').array().notNull().default(sql`'{}'::text[]`),
    expertise: text('expertise').array().notNull().default(sql`'{}'::text[]`),
    languages: text('languages').array().notNull().default(sql`'{}'::text[]`),
    capacity: integer('capacity').notNull().default(10),
    availability: text('availability').notNull().default('active'),
    attributes: jsonb('attributes').$type<Record<string, AttributeValue>>().notNull().default({}),
    profile: text('profile').notNull().default(''),
    notes: text('notes').notNull().default(''),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_staff_profiles_org').on(t.organizationId),
    index('idx_staff_profiles_sectors').using('gin', t.sectors),
    index('idx_staff_profiles_expertise').using('gin', t.expertise),
    index('idx_staff_profiles_languages').using('gin', t.languages),
    check('staff_profiles_availability_check', sql`availability IN ('active','busy','off','inactive')`),
    check('staff_profiles_capacity_check', sql`capacity >= 0`),
  ],
)

/**
 * Per-team free-text description — surfaced to agents for routing context.
 * Keyed by `teamId` (better-auth `auth.team.id`). No FK to `auth.team` because
 * auth tables live in a different pgSchema and deletion is handled at the app
 * layer (see `team-descriptions/remove`).
 */
export const teamDescriptions = teamPgSchema.table(
  'team_descriptions',
  {
    teamId: text('team_id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    description: text('description').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('idx_team_descriptions_org').on(t.organizationId)],
)

export const staffAttributeDefinitions = teamPgSchema.table(
  'staff_attribute_definitions',
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
    uniqueIndex('uq_staff_attr_def_org_key').on(t.organizationId, t.key),
    index('idx_staff_attr_def_org').on(t.organizationId),
    check('staff_attr_def_type_check', sql`type IN ('text','number','boolean','date','enum')`),
  ],
)

// Compile-time drift guards
type _StaffProfileAssert =
  InferSelectModel<typeof staffProfiles> extends Omit<
    StaffProfile,
    'sectors' | 'expertise' | 'languages' | 'attributes' | 'availability'
  >
    ? true
    : never
type _TeamDescriptionAssert = InferSelectModel<typeof teamDescriptions> extends TeamDescription ? true : never
const _teamDescOk: _TeamDescriptionAssert = true
void _teamDescOk
type _StaffAttrDefAssert =
  InferSelectModel<typeof staffAttributeDefinitions> extends Omit<StaffAttributeDefinition, 'type' | 'options'>
    ? true
    : never
const _profileOk: _StaffProfileAssert = true
const _attrDefOk: _StaffAttrDefAssert = true
void _profileOk
void _attrDefOk
