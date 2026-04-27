// `appliedHistoryId` / `appliedProposalId` are soft TEXT refs because
// cross-pgSchema FKs aren't supported by the template pattern. Both rows are
// written in the same transaction inside `decideChangeProposal`, so
// consistency holds at the call site.

import type { ChangePayload } from '@vobase/core'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { check, index, jsonb, real, text, timestamp } from 'drizzle-orm/pg-core'

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
  rationale: string | null
  conversationId: string | null
  decidedByUserId: string | null
  decidedAt: Date | null
  decidedNote: string | null
  appliedHistoryId: string | null
  createdAt: Date
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
    rationale: text('rationale'),
    /** Null for admin-direct proposals; non-null for agent-context proposals (drives the journal-emission branch). */
    conversationId: text('conversation_id'),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedNote: text('decided_note'),
    /** Soft TEXT ref → change_history.id (cross-pgSchema FKs unsupported). */
    appliedHistoryId: text('applied_history_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_change_proposals_inbox').on(t.organizationId, t.status, t.createdAt),
    check(
      'change_proposals_status_check',
      sql`status IN ('pending','approved','rejected','auto_written','superseded')`,
    ),
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
