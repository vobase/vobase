/**
 * agents module schema.
 *
 * Tables: `agent_definitions`, `agent_staff_memory`, `learned_skills`, `agent_scores`,
 * plus operator-thread tables. Harness persistence tables (conversation_events,
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

// ─── Tables ─────────────────────────────────────────────────────────────────

import { DEFAULT_CHAT_MODEL } from '@modules/agents/lib/models'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, numeric, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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
export const agentThreads = agentsPgSchema.table(
  'agent_threads',
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
    index('idx_agent_threads_creator').on(t.organizationId, t.createdBy, t.lastTurnAt),
    index('idx_agent_threads_agent').on(t.agentId, t.lastTurnAt),
    check('agent_threads_status_check', sql`status IN ('open', 'closed', 'archived')`),
  ],
)

/**
 * Append-only message log for agent_threads. `role` mirrors pi's message
 * envelope (`user` | `assistant` | `system` | `tool`); `payload` carries the
 * raw pi-message JSON for one-write-path replay.
 */
export const agentThreadMessages = agentsPgSchema.table(
  'agent_thread_messages',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => agentThreads.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_agent_thread_messages_seq').on(t.threadId, t.seq),
    index('idx_agent_thread_messages_thread').on(t.threadId, t.createdAt),
    check('agent_thread_messages_role_check', sql`role IN ('user', 'assistant', 'system', 'tool')`),
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
