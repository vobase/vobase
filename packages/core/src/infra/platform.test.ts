import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

import type { VobaseDb } from '../db/client';
import { createPlatformIntegrationsRoutes } from './platform';

const HMAC_SECRET = 'test-hmac-secret';

function sign(body: string): string {
  return createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

// Mock integrations service
function createMockService() {
  return {
    getActive: mock(() => Promise.resolve(null)),
    getAll: mock(() => Promise.resolve([])),
    getById: mock(() => Promise.resolve(null)),
    connect: mock(() =>
      Promise.resolve({
        id: 'int_1',
        provider: '',
        config: {},
        label: '',
        authType: 'platform',
        status: 'active' as const,
        scopes: null,
        expiresAt: null,
        configExpiresAt: null,
        lastRefreshAt: null,
        authFailedAt: null,
        error: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    disconnect: mock(() => Promise.resolve()),
    updateConfig: mock(() => Promise.resolve()),
    markError: mock(() => Promise.resolve()),
    markRefreshed: mock(() => Promise.resolve()),
  };
}

describe('platform /:provider/configure', () => {
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.PLATFORM_HMAC_SECRET;
    process.env.PLATFORM_HMAC_SECRET = HMAC_SECRET;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.PLATFORM_HMAC_SECRET;
    } else {
      process.env.PLATFORM_HMAC_SECRET = originalEnv;
    }
  });

  test('stores config for whatsapp provider', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({
      config: {
        accessToken: 'tok',
        phoneNumberId: 'pn1',
        wabaId: 'waba1',
        apiVersion: 'v22.0',
      },
      label: 'WhatsApp (via platform)',
    });

    const res = await routes.request('/whatsapp/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(svc.connect).toHaveBeenCalledWith(
      'whatsapp',
      {
        accessToken: 'tok',
        phoneNumberId: 'pn1',
        wabaId: 'waba1',
        apiVersion: 'v22.0',
      },
      expect.objectContaining({
        authType: 'platform',
        label: 'WhatsApp (via platform)',
      }),
    );
  });

  test('stores config for messenger provider', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({
      config: { pageAccessToken: 'tok', pageId: 'page1' },
      label: 'Messenger (via platform)',
    });

    const res = await routes.request('/messenger/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(svc.connect).toHaveBeenCalledWith(
      'messenger',
      { pageAccessToken: 'tok', pageId: 'page1' },
      expect.objectContaining({
        authType: 'platform',
        label: 'Messenger (via platform)',
      }),
    );
  });

  test('stores config for arbitrary provider (xero)', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({
      config: { accessToken: 'xero-tok', tenantId: 'xt1' },
      scopes: ['accounting.transactions.read'],
      expiresInSeconds: 1800,
    });

    const res = await routes.request('/xero/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(svc.connect).toHaveBeenCalledWith(
      'xero',
      { accessToken: 'xero-tok', tenantId: 'xt1' },
      expect.objectContaining({
        authType: 'platform',
        label: 'xero (via platform)',
        scopes: ['accounting.transactions.read'],
      }),
    );
    // Verify expiresAt was computed
    const opts = (
      svc.connect.mock.calls as unknown as unknown[][]
    )[0][2] as Record<string, unknown>;
    expect(opts.expiresAt).toBeInstanceOf(Date);
  });

  test('rejects missing HMAC signature with 401', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({ config: { token: 'x' } });

    const res = await routes.request('/whatsapp/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(res.status).toBe(401);
    expect(svc.connect).not.toHaveBeenCalled();
  });

  test('rejects invalid HMAC signature with 401', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({ config: { token: 'x' } });

    const res = await routes.request('/whatsapp/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': 'deadbeef'.repeat(8),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(svc.connect).not.toHaveBeenCalled();
  });

  test('rejects missing config field with 400', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({ label: 'no config' });

    const res = await routes.request('/whatsapp/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(400);
    expect(svc.connect).not.toHaveBeenCalled();
  });

  test('rejects non-object config with 400', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({ config: 'not-an-object' });

    const res = await routes.request('/whatsapp/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(400);
    expect(svc.connect).not.toHaveBeenCalled();
  });

  test('defaults label to provider (via platform) when omitted', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({ config: { token: 'x' } });

    const res = await routes.request('/shopify/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(svc.connect).toHaveBeenCalledWith(
      'shopify',
      { token: 'x' },
      expect.objectContaining({
        label: 'shopify (via platform)',
      }),
    );
  });

  test('uses provided label when given', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({
      config: { token: 'x' },
      label: 'My Custom Label',
    });

    const res = await routes.request('/shopify/configure', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(svc.connect).toHaveBeenCalledWith(
      'shopify',
      { token: 'x' },
      expect.objectContaining({
        label: 'My Custom Label',
      }),
    );
  });

  test('returns 404 when PLATFORM_HMAC_SECRET not set', async () => {
    const saved = process.env.PLATFORM_HMAC_SECRET;
    delete process.env.PLATFORM_HMAC_SECRET;

    try {
      const svc = createMockService();
      const routes = createPlatformIntegrationsRoutes({
        db: {} as unknown as VobaseDb,
        integrationsService: svc,
      });

      const body = JSON.stringify({ config: { token: 'x' } });

      const res = await routes.request('/whatsapp/configure', {
        method: 'POST',
        headers: {
          'x-platform-signature': sign(body),
          'content-type': 'application/json',
        },
        body,
      });

      expect(res.status).toBe(404);
      expect(svc.connect).not.toHaveBeenCalled();
    } finally {
      process.env.PLATFORM_HMAC_SECRET = saved;
    }
  });
});

describe('platform /provision-channel', () => {
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.PLATFORM_HMAC_SECRET;
    process.env.PLATFORM_HMAC_SECRET = HMAC_SECRET;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.PLATFORM_HMAC_SECRET;
    } else {
      process.env.PLATFORM_HMAC_SECRET = originalEnv;
    }
  });

  test('route not registered when onProvisionChannel is not provided', async () => {
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
    });

    const body = JSON.stringify({
      type: 'whatsapp',
      label: 'WhatsApp (via platform)',
      source: 'platform',
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    // Without callback, no route is registered — Hono returns 404
    expect(res.status).toBe(404);
  });

  test('provisions channel instance on valid request', async () => {
    const onProvision = mock(() =>
      Promise.resolve({ instanceId: 'inst_abc123' }),
    );
    const svc = createMockService();
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: svc,
      onProvisionChannel: onProvision,
    });

    const body = JSON.stringify({
      type: 'whatsapp',
      label: 'WhatsApp (via platform)',
      source: 'platform',
      integrationId: 'int_1',
      config: { extra: 'data' },
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; instanceId: string };
    expect(json.success).toBe(true);
    expect(json.instanceId).toBe('inst_abc123');
    expect(onProvision).toHaveBeenCalledWith({
      type: 'whatsapp',
      label: 'WhatsApp (via platform)',
      source: 'platform',
      integrationId: 'int_1',
      config: { extra: 'data' },
    });
  });

  test('provisions with minimal body (no optional fields)', async () => {
    const onProvision = mock(() =>
      Promise.resolve({ instanceId: 'inst_min' }),
    );
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: createMockService(),
      onProvisionChannel: onProvision,
    });

    const body = JSON.stringify({
      type: 'messenger',
      label: 'Messenger (via platform)',
      source: 'sandbox',
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; instanceId: string };
    expect(json.instanceId).toBe('inst_min');
    expect(onProvision).toHaveBeenCalledWith({
      type: 'messenger',
      label: 'Messenger (via platform)',
      source: 'sandbox',
    });
  });

  test('rejects missing HMAC signature with 401', async () => {
    const onProvision = mock(() =>
      Promise.resolve({ instanceId: 'x' }),
    );
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: createMockService(),
      onProvisionChannel: onProvision,
    });

    const body = JSON.stringify({
      type: 'whatsapp',
      label: 'WA',
      source: 'platform',
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(res.status).toBe(401);
    expect(onProvision).not.toHaveBeenCalled();
  });

  test('rejects invalid HMAC signature with 401', async () => {
    const onProvision = mock(() =>
      Promise.resolve({ instanceId: 'x' }),
    );
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: createMockService(),
      onProvisionChannel: onProvision,
    });

    const body = JSON.stringify({
      type: 'whatsapp',
      label: 'WA',
      source: 'platform',
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: {
        'x-platform-signature': 'deadbeef'.repeat(8),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(onProvision).not.toHaveBeenCalled();
  });

  test('rejects invalid body (missing type) with 400', async () => {
    const onProvision = mock(() =>
      Promise.resolve({ instanceId: 'x' }),
    );
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: createMockService(),
      onProvisionChannel: onProvision,
    });

    const body = JSON.stringify({
      label: 'WA',
      source: 'platform',
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(400);
    expect(onProvision).not.toHaveBeenCalled();
  });

  test('rejects invalid source enum with 400', async () => {
    const onProvision = mock(() =>
      Promise.resolve({ instanceId: 'x' }),
    );
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: createMockService(),
      onProvisionChannel: onProvision,
    });

    const body = JSON.stringify({
      type: 'whatsapp',
      label: 'WA',
      source: 'invalid-source',
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(400);
    expect(onProvision).not.toHaveBeenCalled();
  });

  test('returns 502 with sanitized error when callback throws', async () => {
    const onProvision = mock(() =>
      Promise.reject(new Error('Database connection lost: ECONNREFUSED')),
    );
    const routes = createPlatformIntegrationsRoutes({
      db: {} as unknown as VobaseDb,
      integrationsService: createMockService(),
      onProvisionChannel: onProvision,
    });

    const body = JSON.stringify({
      type: 'whatsapp',
      label: 'WhatsApp (via platform)',
      source: 'platform',
    });

    const res = await routes.request('/provision-channel', {
      method: 'POST',
      headers: {
        'x-platform-signature': sign(body),
        'content-type': 'application/json',
      },
      body,
    });

    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    // Error must be sanitized — must NOT contain internal details
    expect(json.error).toBe('Provisioning failed');
    expect(json.error).not.toContain('ECONNREFUSED');
    expect(json.error).not.toContain('Database');
  });

  test('returns 404 when PLATFORM_HMAC_SECRET not set', async () => {
    const saved = process.env.PLATFORM_HMAC_SECRET;
    delete process.env.PLATFORM_HMAC_SECRET;

    try {
      const onProvision = mock(() =>
        Promise.resolve({ instanceId: 'x' }),
      );
      const routes = createPlatformIntegrationsRoutes({
        db: {} as unknown as VobaseDb,
        integrationsService: createMockService(),
        onProvisionChannel: onProvision,
      });

      const body = JSON.stringify({
        type: 'whatsapp',
        label: 'WA',
        source: 'platform',
      });

      const res = await routes.request('/provision-channel', {
        method: 'POST',
        headers: {
          'x-platform-signature': sign(body),
          'content-type': 'application/json',
        },
        body,
      });

      expect(res.status).toBe(404);
      expect(onProvision).not.toHaveBeenCalled();
    } finally {
      process.env.PLATFORM_HMAC_SECRET = saved;
    }
  });
});
