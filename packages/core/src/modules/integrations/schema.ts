import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { nanoidPrimaryKey, DEFAULT_COLUMNS } from '../../db/helpers';

export const integrationsTable = sqliteTable(
  '_integrations',
  {
    id: nanoidPrimaryKey(),
    provider: text('provider').notNull(),
    authType: text('auth_type').notNull(),
    label: text('label'),
    status: text('status').notNull().default('active'),
    config: text('config').notNull(), // encrypted JSON blob
    scopes: text('scopes'), // JSON array of granted scopes
    configExpiresAt: integer('config_expires_at', { mode: 'timestamp_ms' }),
    lastRefreshAt: integer('last_refresh_at', { mode: 'timestamp_ms' }),
    authFailedAt: integer('auth_failed_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by'),
    ...DEFAULT_COLUMNS,
  },
  (table) => [
    index('integrations_provider_idx').on(table.provider),
    index('integrations_status_idx').on(table.status),
  ],
);

export const integrationsSchema = { integrationsTable };
