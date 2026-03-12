import { authSchema, apikeySchema, organizationSchema } from './modules/auth/schema';
import { auditLog, recordAudits } from './modules/audit/schema';
import { credentialsTable } from './modules/credentials/schema';
import { sequences } from './modules/sequences/schema';
import { notifyLog } from './modules/notify/schema';
import { storageObjects } from './modules/storage/schema';
import { webhookDedup } from './infra/webhooks-schema';

export interface SchemaConfig {
  /** Include credentials table. Default: true */
  credentials?: boolean;
  /** Include storage tables (Phase 2). Default: false */
  storage?: boolean;
  /** Include notify tables (Phase 3). Default: false */
  notify?: boolean;
  /** Include organization tables (better-auth organization plugin). Default: false */
  organization?: boolean;
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
    // API key table (always active — needed for MCP auth)
    ...apikeySchema,
    // Audit tables (always active)
    auditLog,
    recordAudits,
    // Sequences table (always active)
    sequences,
    // Webhook dedup table (always active)
    webhookDedup,
  };

  // Organization (optional — better-auth organization plugin)
  if (config?.organization) {
    Object.assign(schema, organizationSchema);
  }

  // Credentials (default: included)
  if (config?.credentials !== false) {
    schema.credentialsTable = credentialsTable;
  }

  // Storage (Phase 2)
  if (config?.storage) {
    schema.storageObjects = storageObjects;
  }

  // Notify (Phase 3)
  if (config?.notify) {
    schema.notifyLog = notifyLog;
  }

  return schema;
}
