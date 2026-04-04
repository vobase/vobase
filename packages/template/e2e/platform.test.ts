/**
 * E2E test: Platform integration routes against real server + real DB.
 *
 * Prerequisites:
 *   - docker compose up -d (Postgres running)
 *   - bun run dev (template server on :3000)
 *   - PLATFORM_HMAC_SECRET set in .env
 *
 * Tests the real HMAC verification, Zod validation, DB writes, and callback execution
 * by simulating what vobase-platform does when it calls tenant endpoints.
 */
import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'dev-local-hmac-secret-do-not-use-in-production';
const DB_URL = 'postgres://vobase:vobase@localhost:5432/vobase';

function sign(body: string): string {
  return createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

async function request(path: string, body: Record<string, unknown>) {
  const bodyStr = JSON.stringify(body);
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Platform-Signature': sign(bodyStr),
    },
    body: bodyStr,
  });
}

const sql = postgres(DB_URL);

// Track created resources for cleanup
const createdIntegrationProviders: string[] = [];
const createdInstanceIds: string[] = [];

afterAll(async () => {
  // Clean up test data
  for (const id of createdInstanceIds) {
    await sql`DELETE FROM conversations.channel_instances WHERE id = ${id}`;
  }
  for (const provider of createdIntegrationProviders) {
    await sql`DELETE FROM infra.integrations WHERE provider = ${provider} AND auth_type = 'platform'`;
  }
  await sql.end();
});

describe('E2E: POST /api/integrations/:provider/configure', () => {
  const testProvider = `e2e-test-${Date.now()}`;

  test('stores credentials in integrations vault via real DB', async () => {
    createdIntegrationProviders.push(testProvider);

    const res = await request(`/api/integrations/${testProvider}/configure`, {
      config: {
        accessToken: 'e2e-test-token',
        phoneNumberId: 'pn-e2e',
        appSecret: 'e2e-app-secret',
      },
      label: 'E2E Test Integration',
      scopes: ['messaging', 'webhooks'],
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);

    // Verify DB state
    const [row] = await sql`
      SELECT provider, auth_type, label, status, scopes
      FROM infra.integrations
      WHERE provider = ${testProvider} AND auth_type = 'platform'
    `;
    expect(row).toBeDefined();
    expect(row.provider).toBe(testProvider);
    expect(row.auth_type).toBe('platform');
    expect(row.label).toBe('E2E Test Integration');
    expect(row.status).toBe('active');
  });

  test('rejects request with invalid HMAC', async () => {
    const bodyStr = JSON.stringify({ config: { token: 'x' } });
    const res = await fetch(`${BASE_URL}/api/integrations/fake/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Platform-Signature':
          'bad-signature-000000000000000000000000000000000000000000000000000000000000',
      },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
  });

  test('rejects request with missing signature', async () => {
    const bodyStr = JSON.stringify({ config: { token: 'x' } });
    const res = await fetch(`${BASE_URL}/api/integrations/fake/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
  });

  test('rejects invalid body (missing config)', async () => {
    const res = await request('/api/integrations/fake/configure', {
      label: 'no config field',
    });

    expect(res.status).toBe(400);
  });
});

describe('E2E: POST /api/integrations/provision-channel', () => {
  test('creates channel instance in real DB via callback', async () => {
    const res = await request('/api/integrations/provision-channel', {
      type: 'e2e-test-channel',
      label: 'E2E Test Channel',
      source: 'platform',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; instanceId: string };
    expect(json.success).toBe(true);
    expect(json.instanceId).toBeTruthy();

    createdInstanceIds.push(json.instanceId);

    // Verify DB state
    const [row] = await sql`
      SELECT id, type, label, source, status
      FROM conversations.channel_instances
      WHERE id = ${json.instanceId}
    `;
    expect(row).toBeDefined();
    expect(row.type).toBe('e2e-test-channel');
    expect(row.label).toBe('E2E Test Channel');
    expect(row.source).toBe('platform');
    expect(row.status).toBe('active');
  });

  test('creates channel instance with optional fields', async () => {
    const res = await request('/api/integrations/provision-channel', {
      type: 'e2e-test-messenger',
      label: 'E2E Messenger',
      source: 'sandbox',
      config: { pageId: 'pg-123' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; instanceId: string };
    expect(json.success).toBe(true);

    createdInstanceIds.push(json.instanceId);

    const [row] = await sql`
      SELECT id, type, source, config
      FROM conversations.channel_instances
      WHERE id = ${json.instanceId}
    `;
    expect(row).toBeDefined();
    expect(row.type).toBe('e2e-test-messenger');
    expect(row.source).toBe('sandbox');
  });

  test('rejects invalid source enum', async () => {
    const res = await request('/api/integrations/provision-channel', {
      type: 'whatsapp',
      label: 'WA',
      source: 'invalid',
    });

    expect(res.status).toBe(400);
  });

  test('rejects missing HMAC', async () => {
    const bodyStr = JSON.stringify({
      type: 'whatsapp',
      label: 'WA',
      source: 'platform',
    });
    const res = await fetch(`${BASE_URL}/api/integrations/provision-channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
  });
});

describe('E2E: POST /api/integrations/token/update', () => {
  const tokenTestProvider = `e2e-token-${Date.now()}`;

  test('updates token for platform-managed integration', async () => {
    createdIntegrationProviders.push(tokenTestProvider);

    // First, create an integration via configure
    const configRes = await request(
      `/api/integrations/${tokenTestProvider}/configure`,
      {
        config: { accessToken: 'original-token' },
        label: 'Token Update Test',
      },
    );
    expect(configRes.status).toBe(200);

    // Now update the token
    const res = await request('/api/integrations/token/update', {
      provider: tokenTestProvider,
      accessToken: 'refreshed-token-e2e',
      expiresInSeconds: 3600,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
  });

  test('rejects token update for non-existent provider', async () => {
    const res = await request('/api/integrations/token/update', {
      provider: 'nonexistent-provider-xyz',
      accessToken: 'tok',
    });

    expect(res.status).toBe(404);
  });
});
