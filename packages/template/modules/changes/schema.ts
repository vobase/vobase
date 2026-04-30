// `appliedHistoryId` / `appliedProposalId` are soft TEXT refs because
// cross-pgSchema FKs aren't supported by the template pattern. Both rows are
// written in the same transaction inside `decideChangeProposal`, so
// consistency holds at the call site.

import type { ChangePayload } from '@vobase/core'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { check, index, jsonb, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { changesPgSchema } from '~/runtime'

export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'auto_written' | 'superseded'
export type ChangedByKind = 'user' | 'agent'

export interface ChangeProposalRow {
  id: string
  organizationId: string
  resourceModule: string
  resourceType: string
  resourceId: string
  payload: ChangePayload
  status: ChangeStatus
  confidence: number | null
  /** Free-text "what problem does this solve?" written by the proposer (agent or staff). UI labels it "Problem". */
  rationale: string | null
  /** Free-text "after approval, what changes for the user?" written by the proposer. UI labels it "After approval". */
  expectedOutcome: string | null
  conversationId: string | null
  /** Canonical principal token (`agent:<id>` or `staff:<id>`) of the proposer — drives the initiator avatar on /changes. */
  proposedById: string
  proposedByKind: ChangedByKind
  decidedByUserId: string | null
  decidedAt: Date | null
  decidedNote: string | null
  appliedHistoryId: string | null
  createdAt: Date
}

/** `listInbox` join shape — adds the conversation's `contactId` so the UI can render a clickable contact pill without a second round-trip. */
export interface ChangeProposalInboxItem extends ChangeProposalRow {
  conversationContactId: string | null
}

export interface ChangeHistoryRow {
  id: string
  organizationId: string
  resourceModule: string
  resourceType: string
  resourceId: string
  payload: ChangePayload
  before: unknown
  after: unknown
  changedBy: string
  changedByKind: ChangedByKind
  appliedProposalId: string | null
  createdAt: Date
}

export const changeProposals = changesPgSchema.table(
  'change_proposals',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    resourceModule: text('resource_module').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    payload: jsonb('payload').notNull().$type<ChangePayload>(),
    status: text('status').notNull().$type<ChangeStatus>().default('pending'),
    confidence: real('confidence'),
    /** Plain-prose problem statement written by the proposer; surfaces as "Problem" on /changes. */
    rationale: text('rationale'),
    /** Plain-prose "after approval" outcome written by the proposer; surfaces as "After approval" on /changes. */
    expectedOutcome: text('expected_outcome'),
    /** Null for admin-direct proposals; non-null for agent-context proposals (drives the journal-emission branch). */
    conversationId: text('conversation_id'),
    /** Canonical principal token (`agent:<id>` or `staff:<id>`); never bare. Drives the initiator avatar on /changes. */
    proposedById: text('proposed_by_id').notNull(),
    proposedByKind: text('proposed_by_kind').notNull().$type<ChangedByKind>(),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedNote: text('decided_note'),
    /** Soft TEXT ref → change_history.id (cross-pgSchema FKs unsupported). */
    appliedHistoryId: text('applied_history_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_change_proposals_inbox').on(t.organizationId, t.status, t.createdAt),
    // Partial unique index: at most ONE pending proposal per (org, resource) — the DB
    // enforces what `insertProposal` checks at the service layer. The duplicate scan
    // in service is the friendly error path; this index is the last-line safety net
    // against a concurrent insert race.
    uniqueIndex('uniq_change_proposals_pending_target')
      .on(t.organizationId, t.resourceModule, t.resourceType, t.resourceId)
      .where(sql`status = 'pending'`),
    check(
      'change_proposals_status_check',
      sql`status IN ('pending','approved','rejected','auto_written','superseded')`,
    ),
    check('change_proposals_kind_check', sql`proposed_by_kind IN ('user','agent')`),
  ],
)

export const changeHistory = changesPgSchema.table(
  'change_history',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    resourceModule: text('resource_module').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    payload: jsonb('payload').notNull().$type<ChangePayload>(),
    before: jsonb('before'),
    after: jsonb('after'),
    changedBy: text('changed_by').notNull(),
    changedByKind: text('changed_by_kind').notNull().$type<ChangedByKind>(),
    /** Soft TEXT ref → change_proposals.id when this row was materialized from a proposal. */
    appliedProposalId: text('applied_proposal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_change_history_resource').on(t.resourceModule, t.resourceType, t.resourceId, t.createdAt),
    check('change_history_kind_check', sql`changed_by_kind IN ('user','agent')`),
  ],
)
