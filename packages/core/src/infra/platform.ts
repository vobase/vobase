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

/**
 * Platform integration routes — stable contract for vobase-platform.
 * Only active when PLATFORM_HMAC_SECRET env var is set.
 *
 * ═══════════════════════════════════════════════════════════════════
 * PLATFORM ↔ TENANT CONTRACT (v1.1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * HMAC SIGNING CONVENTION:
 *   Both directions use HMAC-SHA256 with the same per-tenant shared secret.
 *   Tenant stores it as PLATFORM_HMAC_SECRET env var.
 *   Platform stores it encrypted in the tenants table (hmacSecret column).
 *
 *   Platform → Tenant:
 *     Header: X-Platform-Signature = hex(HMAC-SHA256(secret, rawBody))
 *
 *   Tenant → Platform:
 *     Header: X-Platform-Signature = hex(HMAC-SHA256(secret, method+path))
 *     Header: X-Tenant-Id = tenantId (immutable nanoid — identifies which secret to verify against)
 *     Payload is method+path (e.g., "POST/api/managed-whatsapp/ch123/graph/12345/messages")
 *     — works for JSON, FormData, binary, and GET requests.
 *     Legacy body-based signing also accepted by platform during migration.
 *     Uses PLATFORM_TENANT_ID env var (not slug — slugs are mutable).
 *
 * ─── PLATFORM → TENANT (frozen v1) ────────────────────────────────
 *
 * POST /api/integrations/:provider/configure
 *   Body: { config: Record<string, unknown>, label?: string, scopes?: string[], expiresInSeconds?: number }
 *   Provider param: /^[a-z0-9-]+$/
 *   Stores provider credentials in the integrations vault. Upserts if authType='platform' exists.
 *
 * POST /api/integrations/token/update
 *   Body: { provider: string, accessToken: string, expiresInSeconds?: number }
 *   Updates access token for an existing platform-managed integration.
 *
 * POST /api/integrations/provision-channel
 *   Body: { type: string, label: string, source: 'platform' | 'sandbox', integrationId?: string, config?: Record<string, unknown> }
 *   Success: { success: true, instanceId: string } (200)
 *   Callback error: { error: string } (502).
 *
 * POST /api/channels/webhook/:channelType/:instanceId?
 *   Forwards inbound webhooks from external providers (WhatsApp, etc.).
 *   Raw body preserved. Instance-ID enables per-channel routing.
 *
 * GET /api/auth/platform-callback?token=JWT
 *   Handled by platformAuth better-auth plugin (not in this file).
 *   Exchanges a platform-signed JWT for a tenant session.
 *
 * All endpoints require X-Platform-Signature. Returns 404 if PLATFORM_HMAC_SECRET unset.
 *
 * ─── TENANT → PLATFORM (v1.1) ─────────────────────────────────────
 *
 * Tenant calls platform to consume shared services. Platform verifies
 * X-Platform-Signature + X-Tenant-Id (immutable nanoid), looking up the tenant's HMAC
 * secret from the tenants table. Tenant signs with signPlatformRequest().
 *
 * GET /api/managed-whatsapp/channels
 *   Lists available managed WhatsApp test numbers.
 *   Response: { channels: [{ id, displayNumber, label, phoneNumberId, status }] }
 *
 * ALL /api/managed-whatsapp/:channelId/graph/*
 *   Generic Graph API proxy. Forwards request to graph.facebook.com/v22.0/{path}
 *   with platform-held Bearer token. Preserves method, query params, Content-Type, body.
 *   HMAC signing: method+path (e.g., "POST/12345/messages").
 *   Rate limited: 100 reqs/min/tenant.
 *
 * GET /api/managed-whatsapp/:channelId/media-download?url={cdnUrl}
 *   Binary media download proxy. Validates Meta CDN domain allowlist.
 *   Fetches with platform-held Bearer token, streams binary back.
 *   Rate limited: 100 reqs/min/tenant.
 *
 * ═══════════════════════════════════════════════════════════════════
 */

function getPlatformSecret(): string | null {
  return process.env.PLATFORM_HMAC_SECRET || null;
}

/** Sign a request body with HMAC-SHA256. Symmetric to verifyPlatformSignature. */
export function signPlatformRequest(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
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

/** Config for platform integration routes. */
export interface PlatformRoutesConfig {
  db: VobaseDb;
  integrationsService: IntegrationsService;
  /** Channels service — provision route delegates to channels.provision(). */
  channels: ChannelsService;
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

  const tokenUpdateSchema = z.object({
    provider: z.string().min(1),
    accessToken: z.string().min(1),
    expiresInSeconds: z.number().optional(),
  });

  routes.post('/token/update', async (c) => {
    const verified = await verifyPlatformRequest(c);
    if (verified instanceof Response) return verified;
    const { rawBody } = verified;

    let body: z.infer<typeof tokenUpdateSchema>;
    try {
      body = tokenUpdateSchema.parse(JSON.parse(rawBody));
    } catch {
      return c.json({ error: 'Invalid request body' }, 400);
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
      { expiresAt, markRefreshed: true },
    );

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

  const provisionBodySchema = z.object({
    type: z.string().min(1),
    label: z.string().min(1),
    source: z.enum(['platform', 'sandbox']),
    integrationId: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  });

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
      const result = await config.channels.provision(body);
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

    const expiresAt = body.expiresInSeconds
      ? new Date(Date.now() + body.expiresInSeconds * 1000)
      : undefined;

    // Upsert: update existing platform-managed integration instead of creating duplicates
    const existing = await config.integrationsService.getActive(provider);
    if (existing && existing.authType === 'platform') {
      await config.integrationsService.updateConfig(existing.id, body.config, {
        expiresAt,
        markRefreshed: true,
        label: body.label,
        scopes: body.scopes,
      });
      logger.info(`[platform] ${provider} credentials updated via platform`, {
        provider,
        integrationId: existing.id,
      });
    } else {
      const opts: ConnectOptions = {
        authType: 'platform',
        label: body.label ?? `${provider} (via platform)`,
        ...(body.scopes && { scopes: body.scopes }),
        ...(expiresAt && { expiresAt }),
      };
      await config.integrationsService.connect(provider, body.config, opts);
      logger.info(`[platform] ${provider} configured via platform`, {
        provider,
      });
    }

    return c.json({ success: true });
  });

  return routes;
}
