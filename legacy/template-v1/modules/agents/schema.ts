import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, index, pgSchema, text, timestamp, unique } from 'drizzle-orm/pg-core'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI pgSchema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const agentsPgSchema = pgSchema('agents')

/**
 * AgentDefinitions — DB-driven agent registry.
 * Each row defines an agent that can be instantiated dynamically at wake time.
 * Behavioral config (AGENTS.md, SOUL.md) lives in workspace_files scoped by agentId.
 */
export const agentDefinitions = agentsPgSchema.table(
  'agent_definitions',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    model: text('model').notNull(), // provider/model format: 'openai/gpt-5.4'
    channels: text('channels').array().notNull().default(sql`ARRAY['web']::text[]`),
    mode: text('mode').notNull().default('full-auto'), // 'full-auto' | 'qualify-then-handoff'
    suggestions: text('suggestions').array().notNull().default(sql`'{}'::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('agent_definitions_enabled_idx').on(table.enabled),
    check('agent_definitions_mode_check', sql`mode IN ('full-auto', 'qualify-then-handoff')`),
  ],
)

/**
 * WorkspaceFiles — virtual filesystem backing store for agent workspaces.
 * Global files (AGENTS.md, SOUL.md, skills/) have agentId=null, contactId=null.
 * Per-contact files (notes.md) are scoped by agentId + contactId.
 */
export const workspaceFiles = agentsPgSchema.table(
  'workspace_files',
  {
    id: nanoidPrimaryKey(),
    agentId: text('agent_id'), // null = global file
    contactId: text('contact_id'), // null = non-contact-scoped
    path: text('path').notNull(),
    content: text('content').notNull(),
    writtenBy: text('written_by'), // 'agent', 'admin', 'system', 'migration'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workspace_files_scope_path_idx').on(table.agentId, table.contactId, table.path).nullsNotDistinct(),
    index('workspace_files_agent_idx').on(table.agentId),
    index('workspace_files_contact_idx').on(table.contactId),
  ],
)

/**
 * ModerationLogs — records content blocked by the moderation guardrail.
 * Written by the onBlock callback in the moderation processor.
 */
export const aiModerationLogs = agentsPgSchema.table(
  'moderation_logs',
  {
    id: nanoidPrimaryKey(),
    agentId: text('agent_id').notNull(),
    channel: text('channel').notNull(), // 'web', 'whatsapp', 'email', etc.
    userId: text('user_id'),
    contactId: text('contact_id'),
    threadId: text('thread_id'),
    reason: text('reason').notNull(), // 'blocklist' | 'max_length'
    blockedContent: text('blocked_content'), // truncated to 200 chars in app layer
    matchedTerm: text('matched_term'), // the specific blocklist term that matched
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_logs_created_idx').on(table.createdAt),
    index('moderation_logs_agent_created_idx').on(table.agentId, table.createdAt),
  ],
)
