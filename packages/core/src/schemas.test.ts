import { describe, expect, test } from 'bun:test';

import { getActiveSchemas } from './schemas';

describe('getActiveSchemas', () => {
  test('returns auth, audit, sequences, webhook_dedup, and integrations by default', () => {
    const schemas = getActiveSchemas();
    // Auth tables (always active)
    expect(schemas.user).toBeDefined();
    expect(schemas.session).toBeDefined();
    expect(schemas.account).toBeDefined();
    expect(schemas.verification).toBeDefined();
    // Audit tables (always active)
    expect(schemas.auditLog).toBeDefined();
    expect(schemas.recordAudits).toBeDefined();
    // Sequences (always active)
    expect(schemas.sequences).toBeDefined();
    // Webhook dedup (always active)
    expect(schemas.webhookDedup).toBeDefined();
    // Credentials (default: included)
    expect(schemas.integrationsTable).toBeDefined();
  });

  test('excludes integrations when integrations: false', () => {
    const schemas = getActiveSchemas({ integrations: false });
    expect(schemas.integrationsTable).toBeUndefined();
    // Other tables still present
    expect(schemas.user).toBeDefined();
    expect(schemas.auditLog).toBeDefined();
    expect(schemas.sequences).toBeDefined();
    expect(schemas.webhookDedup).toBeDefined();
  });

  test('includes integrations when integrations: true', () => {
    const schemas = getActiveSchemas({ integrations: true });
    expect(schemas.integrationsTable).toBeDefined();
  });

  test('returns a plain object with all table definitions', () => {
    const schemas = getActiveSchemas();
    const keys = Object.keys(schemas);
    // At minimum: 4 auth + 2 audit + 1 sequences + 1 webhook + 1 integrations = 9
    expect(keys.length).toBeGreaterThanOrEqual(9);
  });
});
