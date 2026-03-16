import { authSchema, apikeySchema, organizationSchema } from './modules/auth/schema';
import { auditLog, recordAudits } from './modules/audit/schema';
import { integrationsTable } from './modules/integrations/schema';
import { sequences } from './modules/sequences/schema';
import { channelsLog, channelsTemplates } from './modules/channels/schema';
import { storageObjects } from './modules/storage/schema';
import { webhookDedup } from './infra/webhooks-schema';

export interface SchemaConfig {
  /** Include integrations table. Default: true */
  integrations?: boolean;
  /** Include storage tables. Default: false */
  storage?: boolean;
  /** Include channels tables (log + templates). Default: false */
  channels?: boolean;
  /** Include organization tables (better-auth organization plugin). Default: false */
  organization?: boolean;
}

/**
 * Returns a merged schema object containing all active Drizzle table
 * definitions based on config. Use with drizzle-kit for migration generation.
 *
 * Always included: auth, audit, sequences, webhook dedup.
 * Conditionally included: integrations, storage, channels.
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

  // Integrations (default: included)
  if (config?.integrations !== false) {
    schema.integrationsTable = integrationsTable;
  }

  // Storage (Phase 2)
  if (config?.storage) {
    schema.storageObjects = storageObjects;
  }

  // Channels
  if (config?.channels) {
    schema.channelsLog = channelsLog;
    schema.channelsTemplates = channelsTemplates;
  }

  return schema;
}
