import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import * as z from 'zod';

import type { VobaseDb } from '../db/client';
import type { ChannelsService } from '../modules/channels/service';
import type {
  ConnectOptions,
  IntegrationsService,
} from '../modules/integrations/service';
import { logger } from './logger';
import type { Scheduler } from './queue';

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
 * POST /api/integrations/provision-channel
 *   Body: { type: string, label: string, source: 'platform' | 'sandbox', integrationId?: string, config?: Record<string, unknown> }
 *   Requires: onProvisionChannel callback in PlatformRoutesConfig.
 *   Success: { success: true, instanceId: string } (200)
 *   Callback error: { error: string } (502) — real error logged server-side.
 *   Not registered if callback not provided.
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

/** Data passed to the onProvisionChannel callback after HMAC + Zod validation. */
export interface ProvisionChannelData {
  type: string;
  label: string;
  source: 'platform' | 'sandbox';
  integrationId?: string;
  config?: Record<string, unknown>;
}

/** Runtime context injected into the onProvisionChannel callback by createApp. */
export interface ProvisionChannelCtx {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
}

/** Config for platform integration routes. */
export interface PlatformRoutesConfig {
  db: VobaseDb;
  integrationsService: IntegrationsService;
  /** Optional callback for channel instance provisioning. Route only registered when provided. */
  onProvisionChannel?: (
    data: ProvisionChannelData,
  ) => Promise<{ instanceId: string }>;
}

/**
 * Verify HMAC signature on a platform request. Returns the raw body on success,
 * or a Response to short-circuit with on failure.
 */
async function verifyPlatformRequest(
  c: Context,
): Promise<{ rawBody: string } | Response> {
  const secret = getPlatformSecret();
  if (!secret) return c.text('Not found', 404);

  const signature = c.req.header('x-platform-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 401);

  const rawBody = await c.req.text();
  if (!verifyPlatformSignature(rawBody, signature)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  return { rawBody };
}

/** Platform integrations routes — see FROZEN CONTRACT block above for shape details. */
export function createPlatformIntegrationsRoutes(config: PlatformRoutesConfig) {
  const routes = new Hono();

  routes.post('/token/update', async (c) => {
    const verified = await verifyPlatformRequest(c);
    if (verified instanceof Response) return verified;
    const { rawBody } = verified;

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

  // NOTE: /token/update and /provision-channel MUST be registered before
  // /:provider/configure to avoid route shadowing (Hono's trie router
  // resolves literals before params).

  // Conditionally register /provision-channel only when callback is provided.
  // This avoids route collisions if the consumer still defines its own handler.
  if (config.onProvisionChannel) {
    const provisionBodySchema = z.object({
      type: z.string().min(1),
      label: z.string().min(1),
      source: z.enum(['platform', 'sandbox']),
      integrationId: z.string().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    });

    const onProvision = config.onProvisionChannel;

    routes.post('/provision-channel', async (c) => {
      const verified = await verifyPlatformRequest(c);
      if (verified instanceof Response) return verified;
      const { rawBody } = verified;

      let body: z.infer<typeof provisionBodySchema>;
      try {
        body = provisionBodySchema.parse(JSON.parse(rawBody));
      } catch {
        return c.json({ error: 'Invalid request body' }, 400);
      }

      try {
        const result = await onProvision(body);
        logger.info('[platform] Channel provisioned via platform', {
          type: body.type,
          instanceId: result.instanceId,
        });
        return c.json({ success: true, instanceId: result.instanceId });
      } catch (err) {
        logger.error('[platform] provision-channel callback failed', {
          type: body.type,
          error: err instanceof Error ? err.message : String(err),
        });
        return c.json({ error: 'Provisioning failed' }, 502);
      }
    });
  }

  const configureBodySchema = z.object({
    config: z.record(z.string(), z.unknown()),
    label: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    expiresInSeconds: z.number().optional(),
  });
  const providerParamSchema = z.string().regex(/^[a-z0-9-]+$/);

  routes.post('/:provider/configure', async (c) => {
    const verified = await verifyPlatformRequest(c);
    if (verified instanceof Response) return verified;
    const { rawBody } = verified;

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
