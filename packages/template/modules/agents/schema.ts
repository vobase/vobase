import { nanoidPrimaryKey } from '@vobase/core/schema';
import { index, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI pgSchema — moderation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const agentsPgSchema = pgSchema('agents');

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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('moderation_logs_created_idx').on(table.createdAt),
    index('moderation_logs_agent_created_idx').on(
      table.agentId,
      table.createdAt,
    ),
  ],
);
