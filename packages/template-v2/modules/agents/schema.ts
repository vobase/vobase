/**
 * agents module schema.
 *
 * Four tables:
 *   - `agent_definitions`
 *   - `learned_skills`
 *   - `learning_proposals`
 *   - `agent_scores`
 *
 * Harness persistence tables (conversation_events, active_wakes, threads,
 * messages, tenant_cost_daily, audit_wake_map) live in `@vobase/core` under
 * pgSchema `harness`. Cross-schema FKs (learning_proposals.wake_event_id →
 * harness.conversation_events, harness.threads.agent_id → agents.agent_definitions)
 * are enforced post-push by `scripts/db-apply-extras.ts`.
 */

// ─── Domain types ───────────────────────────────────────────────────────────

export interface AgentDefinition {
  id: string
  organizationId: string
  name: string
  instructions: string
  model: string
  maxSteps: number | null
  workingMemory: string
  skillAllowlist: string[] | null
  cardApprovalRequired: boolean
  fileApprovalRequired: boolean
  bookSlotApprovalRequired: boolean
  maxOutputTokens: number | null
  maxInputTokens: number | null
  maxTurnsPerWake: number | null
  softCostCeilingUsd: string | null
  hardCostCeilingUsd: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type LearningScope = 'contact' | 'agent_memory' | 'agent_skill' | 'drive_doc'
export type LearningAction = 'upsert' | 'create' | 'patch'
export type LearningStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'auto_written'

export interface LearningProposal {
  id: string
  organizationId: string
  conversationId: string
  wakeEventId: number | null
  scope: LearningScope
  action: LearningAction
  target: string
  body: string | null
  rationale: string | null
  confidence: number | null
  status: LearningStatus
  decidedByUserId: string | null
  decidedAt: Date | null
  decidedNote: string | null
  approvedWriteId: string | null
  createdAt: Date
}

/**
 * Markdown section materialised under `agent_memory.working_memory` whenever a
 * learning proposal is rejected. Anti-lessons live as a `## Anti-lessons` section
 * (not a column), keyed by `<proposal target>: <decidedNote>`.
 */
export interface AgentMemoryAntiLessons {
  readonly heading: 'Anti-lessons'
  entries: ReadonlyArray<{
    target: string
    scope: LearningScope
    note: string
    rejectedAt: string
  }>
}

export type ModerationCategory = 'hate' | 'harassment' | 'violence' | 'sexual' | 'prompt_injection' | 'policy_violation'

export interface AgentScore {
  id: string
  organizationId: string
  conversationId: string
  wakeTurnIndex: number
  scorer: string
  score: number
  rationale: string | null
  model: string | null
  createdAt: Date
}

// ─── Tables ─────────────────────────────────────────────────────────────────

import { agentsPgSchema } from '@server/db/pg-schemas'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { DEFAULT_CHAT_MODEL } from './lib/models'

export const agentDefinitions = agentsPgSchema.table('agent_definitions', {
  id: nanoidPrimaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  instructions: text('instructions').notNull().default(''),
  model: text('model').notNull().default(DEFAULT_CHAT_MODEL),
  maxSteps: integer('max_steps').default(20),
  workingMemory: text('working_memory').notNull().default(''),
  skillAllowlist: text('skill_allowlist').array(),
  cardApprovalRequired: boolean('card_approval_required').notNull().default(true),
  fileApprovalRequired: boolean('file_approval_required').notNull().default(true),
  bookSlotApprovalRequired: boolean('book_slot_approval_required').notNull().default(true),
  maxOutputTokens: integer('max_output_tokens').default(4096),
  maxInputTokens: integer('max_input_tokens').default(32768),
  maxTurnsPerWake: integer('max_turns_per_wake').default(10),
  softCostCeilingUsd: numeric('soft_cost_ceiling_usd', { precision: 10, scale: 4 }),
  hardCostCeilingUsd: numeric('hard_cost_ceiling_usd', { precision: 10, scale: 4 }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const learnedSkills = agentsPgSchema.table(
  'learned_skills',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    agentId: text('agent_id').references(() => agentDefinitions.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    tags: text('tags').array().notNull().default([]),
    version: integer('version').default(1),
    parentProposalId: text('parent_proposal_id'),
    threatScanReport: jsonb('threat_scan_report'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('uq_learned_skills_name').on(t.organizationId, t.agentId, t.name)],
)

export const learningProposals = agentsPgSchema.table(
  'learning_proposals',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    /** Self-ref to harness.conversation_events.id; enforced post-push. */
    wakeEventId: bigint('wake_event_id', { mode: 'number' }),
    scope: text('scope').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull(),
    body: text('body'),
    rationale: text('rationale'),
    confidence: real('confidence'),
    status: text('status').notNull().default('pending'),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedNote: text('decided_note'),
    approvedWriteId: text('approved_write_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_proposals_status').on(t.organizationId, t.status, t.createdAt),
    check('lp_scope_check', sql`scope IN ('contact','agent_memory','agent_skill','drive_doc')`),
    check('lp_action_check', sql`action IN ('upsert','create','patch')`),
    check('lp_status_check', sql`status IN ('pending','approved','rejected','superseded','auto_written')`),
  ],
)

export const agentScores = agentsPgSchema.table(
  'agent_scores',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    wakeTurnIndex: integer('wake_turn_index').notNull(),
    scorer: text('scorer').notNull(),
    score: real('score').notNull(),
    rationale: text('rationale'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_scores_conv').on(t.conversationId, t.wakeTurnIndex)],
)
