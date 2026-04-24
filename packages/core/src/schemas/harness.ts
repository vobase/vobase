/**
 * Harness persistence tables — journal, wake coordination, agent thread history,
 * cost aggregation, audit linkage.
 *
 * Six tables under pgSchema `harness`:
 *   - `conversation_events` — append-only observability journal (one-write-path via `journal.ts`)
 *   - `active_wakes` — UNLOGGED coordination table (debounce + in-flight guard)
 *   - `threads` — one row per wake source (agent conversation / cron / adhoc)
 *   - `messages` — pi AgentMessage[] rows keyed to threads
 *   - `tenant_cost_daily` — daily LLM spend rollup
 *   - `audit_wake_map` — satellite of `audit.audit_log` carrying per-wake scope
 *
 * Cross-schema FKs (enforced post-push by the consuming template):
 *   - `threads.agent_id → <agents schema>.agent_definitions(id)`
 *   - `audit_wake_map.audit_log_id → audit.audit_log(id)`
 */

import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { nanoidPrimaryKey } from '../db/helpers'
import { harnessPgSchema } from '../db/pg-schemas'

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

export const conversationEvents = harnessPgSchema.table(
  'conversation_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    conversationId: text('conversation_id').notNull(),
    organizationId: text('organization_id').notNull(),
    wakeId: text('wake_id'),
    turnIndex: integer('turn_index').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    type: text('type').notNull(),
    role: text('role'),
    content: text('content'),
    toolCallId: text('tool_call_id'),
    toolCalls: jsonb('tool_calls'),
    toolName: text('tool_name'),
    reasoning: text('reasoning'),
    reasoningDetails: jsonb('reasoning_details'),
    tokenCount: integer('token_count'),
    finishReason: text('finish_reason'),
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
 * drizzle-kit doesn't emit `UNLOGGED`; the consuming template runs
 * `ALTER TABLE harness.active_wakes SET UNLOGGED` post-push.
 */
export const activeWakes = harnessPgSchema.table('active_wakes', {
  conversationId: text('conversation_id').primaryKey(),
  workerId: text('worker_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  debounceUntil: timestamp('debounce_until', { withTimezone: true }).notNull(),
})

export const threads = harnessPgSchema.table(
  'threads',
  {
    id: nanoidPrimaryKey(),
    agentId: text('agent_id').notNull(),
    kind: text('kind').notNull(),
    conversationId: text('conversation_id'),
    cronKey: text('cron_key'),
    parentThreadId: text('parent_thread_id'),
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

export const agentMessages = harnessPgSchema.table(
  'messages',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    payload: jsonb('payload').notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_agent_msg_seq').on(t.threadId, t.seq), index('idx_agent_msg_thread').on(t.threadId, t.seq)],
)

export const tenantCostDaily = harnessPgSchema.table(
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

export const auditWakeMap = harnessPgSchema.table(
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
