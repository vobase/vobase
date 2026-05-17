/**
 * team module schema.
 *
 * Two tables in the `team` pgSchema:
 *   - `staff_profiles` — per-user domain profile (sectors, expertise, capacity,
 *     availability, attributes, plus a `profile` narrative (human-authored,
 *     routing hints) and `memory` markdown (agent-authored, distilled memory).
 *   - `staff_attribute_definitions` — org-scoped schema for the `attributes` JSONB
 *     (clone of `contact_attribute_definitions`).
 *
 * Identity / auth / team-membership live in better-auth (`auth.user`,
 * `auth.member`, `auth.team_member`). Channel identities live in
 * `contacts.staff_channel_bindings`. The `profile` / `memory` columns are
 * surfaced as virtual `/PROFILE.md` + `/MEMORY.md` files under Drive
 * `scope='staff'` (mirrors the contact-scope overlay).
 */

import { nanoidPrimaryKey } from '@vobase/core/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { teamPgSchema } from '~/runtime'

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
   * the memory-distill observer. Mirrors `contacts.memory`. Surfaced as
   * `staff:/MEMORY.md` in Drive.
   */
  memory: string
  /** Heartbeat for presence / offline detection (mentions notification flow). */
  lastSeenAt: Date | null
  /**
   * Personal phone in E.164 (`+`-prefixed). NOT a `staff_profiles` column — it
   * lives on the better-auth `user` table (phone-number plugin) and is joined
   * in by the staff service on read. Set by an admin at invite time or via the
   * staff profile form. Used by `team/service/staff-ping.ts` to ping the
   * staff member on the org's notification-tier WhatsApp number when an agent
   * @-mentions them in an internal note.
   */
  phoneNumber: string | null
  /**
   * Whether the staff member has completed OTP phone verification (US-021).
   * NOT a `staff_profiles` column — joined from `auth.user.phoneNumberVerified`.
   * `true` = verified and eligible for WhatsApp pings.
   * `false` or `null` = unverified — mention fan-out routes to email fallback.
   */
  phoneNumberVerified: boolean | null
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
    memory: text('memory').notNull().default(''),
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

/**
 * TTL ledger for outbound staff pings. Written by `staff-ping.ts` (kind='mention') after
 * a successful WA send; claimed by the inbound notifications handler when a staff WA reply
 * arrives. Single row per `(conversationId, staffUserId)` — re-pinging refreshes the row.
 *
 * Generalized in US-007 (Slice B.2) to carry a `kind` discriminator so future ping types
 * (`'approval'`, `'proposal'` — US-009) can share the same ledger. Claims are now soft-deletes
 * (`claimed_at` + `claimed_wamid`) instead of DELETE…RETURNING, so the dispatcher can
 * post-hoc inspect what each ping was answered with.
 */
export interface PendingStaffPing {
  conversationId: string
  staffUserId: string
  organizationId: string
  /** Agent that authored the @-mention note (the one waiting on the answer). */
  askingAgentId: string
  /** Note id we're answering — threaded into the reply note's `parentNoteId`. */
  originalNoteId: string
  /**
   * wamid of the outbound WhatsApp ping. Set when the WA send returns a
   * message id; lets an inbound staff reply's `context.id` (the quoted-message
   * wamid, present only when staff use WhatsApp's native reply gesture)
   * exact-match back to this ping. Null when the send returned no id.
   */
  outboundWamid: string | null
  /** Discriminator for the multi-kind ping: 'mention' | 'approval' | 'proposal'. */
  kind: string
  /** Carries the approvalId / proposalId for non-mention kinds; null for 'mention'. */
  referenceId: string | null
  /** Non-null marks the row as claimed (soft-delete sentinel). */
  claimedAt: Date | null
  /** The inbound wamid that claimed this row; null until claimed. */
  claimedWamid: string | null
  createdAt: Date
}

export const pendingStaffPings = teamPgSchema.table(
  'pending_staff_pings',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    staffUserId: text('staff_user_id').notNull(),
    askingAgentId: text('asking_agent_id').notNull(),
    originalNoteId: text('original_note_id').notNull(),
    outboundWamid: text('outbound_wamid'),
    kind: text('kind').notNull().default('mention'),
    referenceId: text('reference_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedWamid: text('claimed_wamid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pending_staff_pings_staff').on(t.staffUserId, t.organizationId),
    index('idx_pending_staff_pings_created').on(t.createdAt),
    uniqueIndex('uq_pending_staff_pings_conv_staff').on(t.conversationId, t.staffUserId),
    // Partial index for live-row scans (claimed_at IS NULL = unclaimed). Keeps
    // the count-aware claim CTE and ambiguity check fast as the table grows.
    index('idx_pending_staff_pings_live').on(t.staffUserId, t.organizationId).where(sql`${t.claimedAt} IS NULL`),
  ],
)

// Compile-time drift guards
// `phoneNumber` and `phoneNumberVerified` are omitted: both are joined in from
// the better-auth `user` table by the staff service, not `staff_profiles` columns.
type _StaffProfileAssert =
  InferSelectModel<typeof staffProfiles> extends Omit<
    StaffProfile,
    'sectors' | 'expertise' | 'languages' | 'attributes' | 'availability' | 'phoneNumber' | 'phoneNumberVerified'
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
type _PendingStaffPingAssert =
  InferSelectModel<typeof pendingStaffPings> extends PendingStaffPing & { id: string } ? true : never
const _profileOk: _StaffProfileAssert = true
const _attrDefOk: _StaffAttrDefAssert = true
const _pendingPingOk: _PendingStaffPingAssert = true
void _profileOk
void _attrDefOk
void _pendingPingOk
