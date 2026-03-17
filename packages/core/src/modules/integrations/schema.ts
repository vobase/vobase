import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { DEFAULT_COLUMNS, nanoidPrimaryKey } from '../../db/helpers';

export const integrationsTable = pgTable(
  '_integrations',
  {
    id: nanoidPrimaryKey(),
    provider: text('provider').notNull(),
    authType: text('auth_type').notNull(),
    label: text('label'),
    status: text('status').notNull().default('active'),
    config: text('config').notNull(), // encrypted JSON blob
    scopes: text('scopes'), // JSON array of granted scopes
    configExpiresAt: timestamp('config_expires_at', { withTimezone: true }),
    lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
    authFailedAt: timestamp('auth_failed_at', { withTimezone: true }),
    createdBy: text('created_by'),
    ...DEFAULT_COLUMNS,
  },
  (table) => [
    index('integrations_provider_idx').on(table.provider),
    index('integrations_status_idx').on(table.status),
  ],
);

export const integrationsSchema = { integrationsTable };
