import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const automationPgSchema = pgSchema('automation');

// ─── Sessions ───────────────────────────────────────────────────────

export const automationSessions = automationPgSchema.table(
  'sessions',
  {
    id: nanoidPrimaryKey(),
    userId: text('user_id').notNull(),
    status: text('status').notNull().default('pairing'),
    browserInfo: jsonb('browser_info'),
    apiKeyId: text('api_key_id'),
    lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
    pairedAt: timestamp('paired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_status_idx').on(table.status),
    check(
      'sessions_status_check',
      sql`status IN ('pairing', 'active', 'disconnected', 'expired')`,
    ),
  ],
);

// ─── Tasks ──────────────────────────────────────────────────────────

export const automationTasks = automationPgSchema.table(
  'tasks',
  {
    id: nanoidPrimaryKey(),
    sessionId: text('session_id').references(() => automationSessions.id),
    adapterId: text('adapter_id').notNull(),
    action: text('action').notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    status: text('status').notNull().default('pending'),
    assignedTo: text('assigned_to'),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    domSnapshot: text('dom_snapshot'),
    errorMessage: text('error_message'),
    requestedBy: text('requested_by').notNull(),
    sourceConversationId: text('source_conversation_id'),
    timeoutMinutes: integer('timeout_minutes').notNull().default(10),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('tasks_status_idx').on(table.status),
    index('tasks_assigned_to_idx').on(table.assignedTo),
    index('tasks_session_id_idx').on(table.sessionId),
    check(
      'tasks_status_check',
      sql`status IN ('pending', 'executing', 'completed', 'failed', 'timeout', 'cancelled')`,
    ),
    check(
      'tasks_requested_by_check',
      sql`requested_by IN ('ai', 'staff', 'system')`,
    ),
  ],
);

// ─── Pairing Codes ──────────────────────────────────────────────────

export const automationPairingCodes = automationPgSchema.table(
  'pairing_codes',
  {
    id: nanoidPrimaryKey(),
    code: text('code').notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id').references(() => automationSessions.id),
    status: text('status').notNull().default('active'),
    /** Plaintext API key — stored only until redeemed, then cleared. */
    apiKey: text('api_key'),
    apiKeyId: text('api_key_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('pairing_codes_code_unique_idx').on(table.code),
    check(
      'pairing_codes_status_check',
      sql`status IN ('active', 'used', 'expired')`,
    ),
  ],
);
