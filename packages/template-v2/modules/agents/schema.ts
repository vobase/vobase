/**
 * agents module schema.
 *
 * Nine tables:
 *   - `agent_definitions`
 *   - `conversation_events` — the append-only journal (one-write-path invariant)
 *   - `active_wakes` — UNLOGGED ephemeral coordination
 *   - `learned_skills`
 *   - `learning_proposals`
 *   - `agent_scores`
 *   - `tenant_cost_daily`
 *   - `threads` — pi AgentMessage[] context per wake source (NOT inbox.messages — see comment)
 *   - `messages` — individual pi AgentMessage rows keyed to threads
 *
 * Note: `agents.messages` stores LLM-context for pi (assistant + tool_result rows).
 * It is NOT the customer transcript — that lives in `inbox.messages`.
 *
 * Cross-schema FKs to `inbox.conversations(id)`, `inbox.messages(id)`.
 * `conversation_events.wake_id` carries the stable wake identifier so
 * audit/journal queries can scope by wake.
 */

// ─── Domain types ───────────────────────────────────────────────────────────

export interface AgentDefinition {
  id: string
  organizationId: string
  name: string
  soulMd: string
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

export interface ConversationEvent {
  id: number
  conversationId: string
  organizationId: string
  turnIndex: number
  ts: Date
  type: string
  role: string | null
  content: string | null
  toolCallId: string | null
  toolCalls: unknown
  toolName: string | null
  reasoning: string | null
  reasoningDetails: unknown
  tokenCount: number | null
  finishReason: string | null
  llmTask: string | null
  tokensIn: number | null
  tokensOut: number | null
  cacheReadTokens: number | null
  costUsd: string | null
  latencyMs: number | null
  model: string | null
  provider: string | null
  wakeId: string | null
  payload: unknown
}

// ─── Tables ─────────────────────────────────────────────────────────────────

import { agentsPgSchema } from '@server/db/pg-schemas'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const agentDefinitions = agentsPgSchema.table('agent_definitions', {
  id: nanoidPrimaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  soulMd: text('soul_md').notNull().default(''),
  model: text('model').notNull().default('claude-sonnet-4-6'),
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

export const conversationEvents = agentsPgSchema.table(
  'conversation_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    /** Cross-schema FK to inbox.conversations(id); enforced post-push. */
    conversationId: text('conversation_id').notNull(),
    organizationId: text('organization_id').notNull(),
    /** Stable identifier per wake — queries use this for per-wake scoping. */
    wakeId: text('wake_id'),
    turnIndex: integer('turn_index').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    type: text('type').notNull(),
    // hermes-shaped columns
    role: text('role'),
    content: text('content'),
    toolCallId: text('tool_call_id'),
    toolCalls: jsonb('tool_calls'),
    toolName: text('tool_name'),
    reasoning: text('reasoning'),
    reasoningDetails: jsonb('reasoning_details'),
    tokenCount: integer('token_count'),
    finishReason: text('finish_reason'),
    // task-tagged llm_call fields
    llmTask: text('llm_task'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    cacheReadTokens: integer('cache_read_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    latencyMs: integer('latency_ms'),
    model: text('model'),
    provider: text('provider'),
    payload: jsonb('payload'),
  },
  (t) => [
    index('idx_convev_conv').on(t.conversationId, t.ts),
    index('idx_convev_type_ts').on(t.type, t.ts),
    index('idx_convev_wake').on(t.wakeId).where(sql`${t.wakeId} IS NOT NULL`),
    index('idx_convev_llm_task').on(t.llmTask, t.ts).where(sql`${t.llmTask} IS NOT NULL`),
  ],
)

/**
 * UNLOGGED table — ephemeral coordination, no WAL overhead.
 * drizzle-kit doesn't yet emit `UNLOGGED`; `scripts/db-apply-extras.ts` runs
 * `ALTER TABLE agents.active_wakes SET UNLOGGED` after push.
 */
export const activeWakes = agentsPgSchema.table('active_wakes', {
  conversationId: text('conversation_id').primaryKey(),
  workerId: text('worker_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  debounceUntil: timestamp('debounce_until', { withTimezone: true }).notNull(),
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
    /** Self-ref to conversation_events.id; enforced post-push. */
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

export const tenantCostDaily = agentsPgSchema.table(
  'tenant_cost_daily',
  {
    organizationId: text('organization_id').notNull(),
    date: date('date').notNull(),
    llmTask: text('llm_task').notNull(),
    tokensIn: bigint('tokens_in', { mode: 'number' }),
    tokensOut: bigint('tokens_out', { mode: 'number' }),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }),
    callCount: integer('call_count'),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.date, t.llmTask] })],
)

/**
 * Agent threads — one row per wake source (conversation, cron job, or ad-hoc).
 * Keyed by (agent_id, conversation_id) or (agent_id, cron_key).
 * `parent_thread_id` supports future compaction forks without a migration.
 */
export const threads = agentsPgSchema.table(
  'threads',
  {
    id: nanoidPrimaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: 'cascade' }),
    /** 'conversation' | 'cron' | 'adhoc' */
    kind: text('kind').notNull(),
    /** Set when kind='conversation'. */
    conversationId: text('conversation_id'),
    /** Set when kind='cron'. */
    cronKey: text('cron_key'),
    /** Future compaction: child thread references parent. */
    parentThreadId: text('parent_thread_id'),
    /** Set when this thread was replaced by a compacted child. */
    compactedAt: timestamp('compacted_at', { withTimezone: true }),
    messageCount: integer('message_count').notNull().default(0),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_thread_conv').on(t.agentId, t.conversationId).where(sql`${t.conversationId} IS NOT NULL`),
    uniqueIndex('uq_thread_cron').on(t.agentId, t.cronKey).where(sql`${t.cronKey} IS NOT NULL`),
    index('idx_thread_agent').on(t.agentId),
  ],
)

/**
 * Agent messages — individual pi AgentMessage rows stored in (thread_id, seq) order.
 * One writer: the `createMessageHistoryObserver` registered per wake.
 * `ON CONFLICT DO NOTHING` on (thread_id, seq) makes crash-mid-checkpoint retries safe.
 */
export const agentMessages = agentsPgSchema.table(
  'messages',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    /** Monotonically increasing within a thread. (thread_id, seq) is UNIQUE. */
    seq: integer('seq').notNull(),
    /** pi AgentMessage — provider-neutral shape (role inside payload). */
    payload: jsonb('payload').notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_agent_msg_seq').on(t.threadId, t.seq), index('idx_agent_msg_thread').on(t.threadId, t.seq)],
)

/**
 * Satellite table keyed to `_audit.auditLog.id` carrying per-wake scope so
 * integration tests can filter audit rows by wake without modifying the
 * core-owned `_audit.auditLog` table. The `auditObserver` writes both rows
 * in the same transaction.
 */
export const auditWakeMap = agentsPgSchema.table(
  'audit_wake_map',
  {
    auditLogId: text('audit_log_id').primaryKey(),
    wakeId: text('wake_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    eventType: text('event_type').notNull(),
    organizationId: text('organization_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_audit_wake_map_wake').on(t.wakeId), index('idx_audit_wake_map_conv').on(t.conversationId)],
)
