/**
 * agents module schema.
 *
 * Tables: `agent_definitions`, `agent_staff_memory`, `learned_skills`, `agent_scores`,
 * plus `operator_threads` / `operator_thread_messages`. Harness persistence tables (conversation_events,
 * active_wakes, threads, messages, tenant_cost_daily, audit_wake_map) live in
 * `@vobase/core` under pgSchema `harness`. Cross-schema FK
 * (`harness.threads.agent_id → agents.agent_definitions`) is enforced post-push
 * by `scripts/db-apply-extras.ts`.
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

/**
 * Triage-emitted "is this worth the agent's attention?" candidate.
 *
 * Surfaces in the next wake's side-load (origin conversation full detail; other
 * conversations abbreviated). Agent decides via `remember` / `dismiss_candidate`.
 * 7-day TTL: `pending` rows older than `LEARN_CANDIDATE_EXPIRY_DAYS` flip to
 * `expired` via `wake/learning/expiry-cron.ts`.
 */
export type LearningCandidateStatus = 'pending' | 'consumed' | 'dismissed' | 'expired'

export type LearningSignalKind =
  | 'staff_takeover'
  | 'coexistence_echo'
  | 'coaching_note'
  | 'rejection'
  | 'self_reflection'
  | 'manual'

export interface LearningCandidate {
  id: string
  organizationId: string
  agentId: string
  conversationId: string
  signalKind: LearningSignalKind
  signalRef: string
  triageConfidence: number
  scopeHint: string | null
  summary: string
  context: string
  status: LearningCandidateStatus
  consumedByProposalId: string | null
  dismissedReason: string | null
  createdAt: Date
  updatedAt: Date
}

// ─── Tables ─────────────────────────────────────────────────────────────────

import { DEFAULT_CHAT_MODEL } from '@modules/agents/lib/models'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { agentsPgSchema } from '~/runtime'

export const agentDefinitions = agentsPgSchema.table(
  'agent_definitions',
  {
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
  },
  (t) => [
    // Partial composite index: keeps the per-note `resolveAgentMentionsInBody`
    // resolver O(log n) as org agent counts grow. Only enabled rows are
    // candidates for wake fan-out.
    index('agent_definitions_org_enabled_idx').on(t.organizationId).where(sql`enabled = true`),
  ],
)

/**
 * Operator chat threads — persistent conversations between a staff member
 * and an operator-role agent. Distinct from `harness.threads` (which tracks
 * pi-agent runtime threads); these are the durable UI artefact rendered in
 * the workspace right rail.
 */
export const operatorThreads = agentsPgSchema.table(
  'operator_threads',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').notNull(),
    title: text('title'),
    status: text('status').notNull().default('open'),
    lastTurnAt: timestamp('last_turn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_operator_threads_creator').on(t.organizationId, t.createdBy, t.lastTurnAt),
    index('idx_operator_threads_agent').on(t.agentId, t.lastTurnAt),
    check('operator_threads_status_check', sql`status IN ('open', 'closed', 'archived')`),
  ],
)

/**
 * Append-only message log for operator_threads. `role` mirrors pi's message
 * envelope (`user` | `assistant` | `system` | `tool`); `payload` carries the
 * raw pi-message JSON for one-write-path replay.
 */
export const operatorThreadMessages = agentsPgSchema.table(
  'operator_thread_messages',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => operatorThreads.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_operator_thread_messages_seq').on(t.threadId, t.seq),
    index('idx_operator_thread_messages_thread').on(t.threadId, t.createdAt),
    check('operator_thread_messages_role_check', sql`role IN ('user', 'assistant', 'system', 'tool')`),
  ],
)

/**
 * Per-agent, per-staff memory. Written via `/staff/<staffId>/MEMORY.md`
 * materializer + workspaceSync observer; read back by the staff-memory
 * materializer. `staff_id` references `auth.user(id)` but is stored as a
 * plain text column — no hard cross-schema FK (the auth schema is managed
 * outside of drizzle-kit's push scope for domain modules).
 */
export const agentStaffMemory = agentsPgSchema.table(
  'agent_staff_memory',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: 'cascade' }),
    staffId: text('staff_id').notNull(),
    memory: text('memory').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('uq_agent_staff_memory').on(t.organizationId, t.agentId, t.staffId)],
)

export interface AgentStaffMemory {
  id: string
  organizationId: string
  agentId: string
  staffId: string
  memory: string
  createdAt: Date
  updatedAt: Date
}

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

/**
 * Triage-emitted candidates for the agent-driven learning loop. The triage
 * job (cheap-model gpt_mini) decides "worth the agent's attention?"; rows
 * that survive surface in the next wake's side-load. Agent acts via
 * `remember` (consumes → proposal) or `dismiss_candidate` (audit). Pending
 * rows older than `LEARN_CANDIDATE_EXPIRY_DAYS` flip to `expired` via the
 * daily cron.
 *
 * Cross-agent isolation: every read filters `agent_id`. MeriGPT never sees
 * Sentinel's pending candidates.
 */
export const learningCandidates = agentsPgSchema.table(
  'learning_candidates',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    agentId: text('agent_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    signalKind: text('signal_kind', {
      enum: ['staff_takeover', 'coexistence_echo', 'coaching_note', 'rejection', 'self_reflection', 'manual'],
    }).notNull(),
    signalRef: text('signal_ref').notNull(),
    triageConfidence: doublePrecision('triage_confidence').notNull(),
    scopeHint: text('scope_hint'),
    summary: text('summary').notNull(),
    context: text('context').notNull(),
    status: text('status', { enum: ['pending', 'consumed', 'dismissed', 'expired'] })
      .notNull()
      .default('pending'),
    consumedByProposalId: text('consumed_by_proposal_id'),
    dismissedReason: text('dismissed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_learning_candidates_pending')
      .on(t.organizationId, t.agentId, t.conversationId, t.status)
      .where(sql`status = 'pending'`),
    index('idx_learning_candidates_status_age').on(t.status, t.createdAt),
    check('learning_candidates_status_check', sql`status IN ('pending','consumed','dismissed','expired')`),
    check(
      'learning_candidates_signal_kind_check',
      sql`signal_kind IN ('staff_takeover','coexistence_echo','coaching_note','rejection','self_reflection','manual')`,
    ),
  ],
)

type _LearningCandidateAssert = InferSelectModel<typeof learningCandidates> extends LearningCandidate ? true : never
const _learningCandidateOk: _LearningCandidateAssert = true
void _learningCandidateOk
