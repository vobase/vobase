import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { DEFAULT_COLUMNS, nanoidPrimaryKey } from '../../db/helpers';
import { infraPgSchema } from '../../db/pg-schemas';

export const integrationsTable = infraPgSchema.table(
  'integrations',
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
    check(
      'integrations_status_check',
      sql`status IN ('active', 'inactive', 'disconnected', 'error')`,
    ),
    uniqueIndex('integrations_active_platform_provider_idx')
      .on(table.provider)
      .where(sql`status = 'active' AND auth_type = 'platform'`),
  ],
);

export const integrationsSchema = { integrationsTable };
