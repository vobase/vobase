import { authSchema } from './db/auth-schema';
import { auditLog, recordAudits } from './modules/audit/schema';
import { credentialsTable } from './modules/credentials/schema';
import { sequences } from './modules/sequences/schema';
import { webhookDedup } from './webhooks-schema';

export interface SchemaConfig {
  /** Include credentials table. Default: true */
  credentials?: boolean;
  /** Include storage tables (Phase 2). Default: false */
  storage?: boolean;
  /** Include notify tables (Phase 3). Default: false */
  notify?: boolean;
}

/**
 * Returns a merged schema object containing all active Drizzle table
 * definitions based on config. Use with drizzle-kit for migration generation.
 *
 * Always included: auth, audit, sequences, webhook dedup.
 * Conditionally included: credentials, storage (Phase 2), notify (Phase 3).
 */
export function getActiveSchemas(config?: SchemaConfig): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    // Auth tables (always active)
    ...authSchema,
    // Audit tables (always active)
    auditLog,
    recordAudits,
    // Sequences table (always active)
    sequences,
    // Webhook dedup table (always active)
    webhookDedup,
  };

  // Credentials (default: included)
  if (config?.credentials !== false) {
    schema.credentialsTable = credentialsTable;
  }

  // Storage and notify schemas will be added in Phase 2 and Phase 3

  return schema;
}
