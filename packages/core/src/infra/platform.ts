import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';

import type { VobaseDb } from '../db/client';
import type { IntegrationsService } from '../modules/integrations/service';
import { logger } from './logger';

/**
 * Platform integration routes — opt-in endpoints for vobase-platform proxy.
 * Only active when PLATFORM_HMAC_SECRET env var is set.
 *
 * Auth callback (GET /api/auth/platform-callback) is handled by the platformAuth
 * better-auth plugin registered in createAuthModule — no separate route needed.
 *
 * This file provides:
 * - POST /api/integrations/whatsapp/configure — accept WhatsApp credentials from platform
 * - POST /api/integrations/token/update — accept refreshed tokens from platform
 *
 * Webhook forwarding is handled separately: the channels webhook handler accepts
 * X-Platform-Signature as an alternative verification method when PLATFORM_HMAC_SECRET is set.
 */

function getPlatformSecret(): string | null {
  return process.env.PLATFORM_HMAC_SECRET || null;
}

/** Verify X-Platform-Signature header against raw body using HMAC-SHA256. */
export function verifyPlatformSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secret = getPlatformSecret();
  if (!secret) return false;

  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (signature.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Check if platform integration is enabled (PLATFORM_HMAC_SECRET is set). */
export function isPlatformEnabled(): boolean {
  return !!getPlatformSecret();
}

export interface PlatformRoutesConfig {
  db: VobaseDb;
  integrationsService: IntegrationsService;
}

/**
 * Platform integrations routes.
 * POST /api/integrations/whatsapp/configure — accept WhatsApp credentials from platform.
 * POST /api/integrations/token/update — accept refreshed tokens from platform.
 */
export function createPlatformIntegrationsRoutes(config: PlatformRoutesConfig) {
  const routes = new Hono();

  /**
   * POST /api/integrations/token/update
   * Platform pushes refreshed access tokens to tenants.
   * Body: { provider, accessToken, expiresInSeconds? }
   * Signed with X-Platform-Signature.
   */
  routes.post('/token/update', async (c) => {
    const secret = getPlatformSecret();
    if (!secret) return c.text('Not found', 404);

    const signature = c.req.header('x-platform-signature');
    if (!signature) return c.json({ error: 'Missing signature' }, 401);

    const rawBody = await c.req.text();
    if (!verifyPlatformSignature(rawBody, signature)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody) as {
      provider: string;
      accessToken: string;
      expiresInSeconds?: number;
    };

    if (!body.provider || !body.accessToken) {
      return c.json({ error: 'Missing provider or accessToken' }, 400);
    }

    // Find the active integration for this provider
    const integration = await config.integrationsService.getActive(body.provider);
    if (!integration) {
      return c.json({ error: `No active integration for provider: ${body.provider}` }, 404);
    }

    // Only allow platform-managed integrations to be updated this way
    if (integration.authType !== 'platform') {
      return c.json({ error: 'Integration is not platform-managed' }, 403);
    }

    // Update the token
    const updatedConfig = { ...integration.config, accessToken: body.accessToken };
    const expiresAt = body.expiresInSeconds
      ? new Date(Date.now() + body.expiresInSeconds * 1000)
      : undefined;

    await config.integrationsService.updateConfig(integration.id, updatedConfig, { expiresAt });
    await config.integrationsService.markRefreshed(integration.id);

    logger.info('[platform] Token updated via platform push', {
      provider: body.provider,
      integrationId: integration.id,
      expiresAt: expiresAt?.toISOString(),
    });

    return c.json({ success: true });
  });

  routes.post('/whatsapp/configure', async (c) => {
    const secret = getPlatformSecret();
    if (!secret) return c.text('Not found', 404);

    const signature = c.req.header('x-platform-signature');
    if (!signature) return c.json({ error: 'Missing signature' }, 401);

    const rawBody = await c.req.text();
    if (!verifyPlatformSignature(rawBody, signature)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody) as {
      accessToken: string;
      phoneNumberId?: string;
      wabaId?: string;
    };

    if (!body.accessToken) {
      return c.json({ error: 'Missing accessToken' }, 400);
    }

    // Store WhatsApp credentials in the integrations vault
    await config.integrationsService.connect(
      'whatsapp',
      {
        accessToken: body.accessToken,
        phoneNumberId: body.phoneNumberId || '',
        wabaId: body.wabaId || '',
        apiVersion: 'v22.0',
      },
      {
        authType: 'platform',
        label: 'WhatsApp (via platform)',
      },
    );

    logger.info('[platform] WhatsApp configured via platform', {
      wabaId: body.wabaId,
      phoneNumberId: body.phoneNumberId,
    });

    return c.json({ success: true });
  });

  return routes;
}
