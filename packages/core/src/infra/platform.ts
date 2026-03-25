import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import * as z from 'zod';

import type { VobaseDb } from '../db/client';
import type {
  ConnectOptions,
  IntegrationsService,
} from '../modules/integrations/service';
import { logger } from './logger';

/**
 * Platform integration routes — stable contract for vobase-platform.
 * Only active when PLATFORM_HMAC_SECRET env var is set.
 *
 * FROZEN CONTRACT (v1) — these endpoints must not change shape:
 *
 * POST /api/integrations/:provider/configure
 *   Body: { config: Record<string, unknown>, label?: string, scopes?: string[], expiresInSeconds?: number }
 *   Provider param: /^[a-z0-9-]+$/
 *   Stores provider credentials in the integrations vault.
 *
 * POST /api/integrations/token/update
 *   Body: { provider: string, accessToken: string, expiresInSeconds?: number }
 *   Updates access token for an existing platform-managed integration.
 *
 * GET /api/auth/platform-callback?token=JWT
 *   Handled by platformAuth better-auth plugin (not in this file).
 *   Exchanges a platform-signed JWT for a tenant session.
 *
 * All POST endpoints require X-Platform-Signature (HMAC-SHA256).
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
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
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

/** Platform integrations routes — see FROZEN CONTRACT block above for shape details. */
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
    const integration = await config.integrationsService.getActive(
      body.provider,
    );
    if (!integration) {
      return c.json(
        { error: `No active integration for provider: ${body.provider}` },
        404,
      );
    }

    // Only allow platform-managed integrations to be updated this way
    if (integration.authType !== 'platform') {
      return c.json({ error: 'Integration is not platform-managed' }, 403);
    }

    // Update the token
    const updatedConfig = {
      ...integration.config,
      accessToken: body.accessToken,
    };
    const expiresAt = body.expiresInSeconds
      ? new Date(Date.now() + body.expiresInSeconds * 1000)
      : undefined;

    await config.integrationsService.updateConfig(
      integration.id,
      updatedConfig,
      { expiresAt },
    );
    await config.integrationsService.markRefreshed(integration.id);

    logger.info('[platform] Token updated via platform push', {
      provider: body.provider,
      integrationId: integration.id,
      expiresAt: expiresAt?.toISOString(),
    });

    return c.json({ success: true });
  });

  // NOTE: /token/update MUST be registered before /:provider/configure
  // to avoid route shadowing (Hono's trie router resolves literals before params).

  const configureBodySchema = z.object({
    config: z.record(z.string(), z.unknown()),
    label: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    expiresInSeconds: z.number().optional(),
  });
  const providerParamSchema = z.string().regex(/^[a-z0-9-]+$/);

  routes.post('/:provider/configure', async (c) => {
    const secret = getPlatformSecret();
    if (!secret) return c.text('Not found', 404);

    const signature = c.req.header('x-platform-signature');
    if (!signature) return c.json({ error: 'Missing signature' }, 401);

    const rawBody = await c.req.text();
    if (!verifyPlatformSignature(rawBody, signature)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    let provider: string;
    try {
      provider = providerParamSchema.parse(c.req.param('provider'));
    } catch {
      return c.json({ error: 'Invalid provider' }, 400);
    }

    let body: z.infer<typeof configureBodySchema>;
    try {
      body = configureBodySchema.parse(JSON.parse(rawBody));
    } catch {
      return c.json({ error: 'Invalid request body' }, 400);
    }

    const opts: ConnectOptions = {
      authType: 'platform',
      label: body.label ?? `${provider} (via platform)`,
      ...(body.scopes && { scopes: body.scopes }),
      ...(body.expiresInSeconds && {
        expiresAt: new Date(Date.now() + body.expiresInSeconds * 1000),
      }),
    };

    await config.integrationsService.connect(provider, body.config, opts);

    logger.info(`[platform] ${provider} configured via platform`, {
      provider,
    });

    return c.json({ success: true });
  });

  return routes;
}
