import { Hono } from 'hono';

import type { ChannelAdapter } from '../../contracts/channels';
import type { VobaseDb } from '../../db/client';
import { logger } from '../../infra/logger';
import { defineBuiltinModule } from '../../module';
import { ChannelEventEmitter } from './events';
import { channelsSchema } from './schema';
import { createChannelsService } from './service';

// OPTIONAL HARDENING: In-memory rate limiter — single-instance only.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    // Clean up stale entries older than 2 seconds
    for (const [key, val] of rateLimitMap) {
      if (now - val.resetAt > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
    return true;
  }

  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

// ─── Config ─────────────────────────────────────────────────────────

export interface WhatsAppChannelConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  apiVersion?: string;
  webhookVerifyToken?: string;
}

export interface EmailChannelConfig {
  provider: 'resend' | 'smtp';
  from: string;
  resend?: { apiKey: string };
  smtp?: {
    host: string;
    port: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  };
}

export interface ChannelsModuleConfig {
  email?: EmailChannelConfig;
  whatsapp?: WhatsAppChannelConfig;
}

// ─── Module Factory ─────────────────────────────────────────────────

export function createChannelsModule(
  db: VobaseDb,
  _config: ChannelsModuleConfig,
) {
  const adapters = new Map<string, ChannelAdapter>();
  const emitter = new ChannelEventEmitter();

  // Register adapters based on config (adapters are registered externally via registerAdapter)
  // Email and WhatsApp adapters are created lazily in the wiring phase (app.ts)

  const service = createChannelsService({ db, adapters, emitter });

  // Webhook routes
  const routes = new Hono();

  routes.post('/webhook/:channelType/:instanceId?', async (c) => {
    const channelType = c.req.param('channelType');
    const instanceId = c.req.param('instanceId');
    const adapter = adapters.get(channelType);

    // M6: Rate limiting per IP
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';
    if (!checkRateLimit(ip)) {
      return c.json({ error: 'Too many requests' }, 429);
    }

    if (!adapter) {
      return c.json({ error: `Unknown channel: ${channelType}` }, 404);
    }

    if (!adapter.verifyWebhook || !adapter.parseWebhook) {
      return c.json(
        { error: `Channel ${channelType} does not support push inbound` },
        400,
      );
    }

    // C6: Parse request body as JSON upfront — fail fast on invalid JSON
    let parsedBody: unknown;
    try {
      parsedBody = await c.req.raw.clone().json();
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    // L3: Validate JSON is a non-null object (not string, number, array, etc.)
    if (
      typeof parsedBody !== 'object' ||
      parsedBody === null ||
      Array.isArray(parsedBody)
    ) {
      return c.json({ error: 'Invalid webhook payload shape' }, 422);
    }

    // Verify webhook signature.
    // Platform-proxied webhooks include X-Platform-Signature but NOT the provider's
    // own signature header (e.g., X-Hub-Signature-256 for WhatsApp). We use the
    // absence of the provider signature to determine if this is a platform-proxied
    // request — this prevents an attacker who compromised the platform secret from
    // bypassing provider-specific verification on direct webhooks.
    const platformSig = c.req.header('x-platform-signature');
    const providerSig =
      c.req.header('x-hub-signature-256') || // WhatsApp/Meta
      c.req.header('stripe-signature'); // Stripe (extensible)
    let isValid = false;
    let viaPlatform = false;

    // L6: Warn when platform signature is present but HMAC secret is not configured
    if (platformSig && !process.env.PLATFORM_HMAC_SECRET) {
      logger.warn(
        'Platform signature present but HMAC secret not configured',
        { channel: channelType },
      );
    }

    if (platformSig && !providerSig && process.env.PLATFORM_HMAC_SECRET) {
      // Platform-proxied webhook: no provider signature present, verify platform HMAC
      const { verifyPlatformSignature } = await import('../../infra/platform');
      const rawBody = await c.req.raw.clone().text();
      isValid = verifyPlatformSignature(rawBody, platformSig);
      viaPlatform = true;
    } else {
      // Direct webhook from provider (or has provider sig): verify with adapter
      isValid = await adapter.verifyWebhook(c.req.raw);
    }

    if (!isValid) {
      logger.warn('Webhook signature verification failed', {
        channel: channelType,
        viaPlatform,
      });
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Resolve channel instance ID: URL param takes precedence, then adapter extraction
    const channelInstanceId =
      instanceId ??
      adapter.extractInstanceIdentifier?.(parsedBody) ??
      undefined;

    // Parse and emit events (non-blocking — return 200 immediately)
    const request = c.req.raw;
    Promise.resolve()
      .then(async () => {
        let events: Awaited<ReturnType<NonNullable<typeof adapter.parseWebhook>>>;
        try {
          events = await adapter.parseWebhook?.(request) ?? [];
        } catch (error) {
          // M12: Classify as adapter_parse_error
          logger.error('Webhook processing error', {
            channel: channelType,
            errorClass: 'adapter_parse_error',
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        for (const event of events) {
          try {
            if (channelInstanceId && 'channelInstanceId' in event === false) {
              (event as { channelInstanceId?: string }).channelInstanceId =
                channelInstanceId;
            }
            emitter.emit(event);
          } catch (error) {
            // M12: Classify as event_processing_error
            logger.error('Webhook processing error', {
              channel: channelType,
              errorClass: 'event_processing_error',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })
      .catch((error) => {
        logger.error('Webhook processing error', {
          channel: channelType,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return c.json({ success: true });
  });

  routes.get('/webhook/:channelType/:instanceId?', (c) => {
    const channelType = c.req.param('channelType');
    const adapter = adapters.get(channelType);

    if (!adapter?.handleWebhookChallenge) {
      return c.json({ error: 'Not supported' }, 404);
    }

    const response = adapter.handleWebhookChallenge(c.req.raw);
    if (response) return response;
    return c.json({ error: 'Challenge failed' }, 400);
  });

  const mod = defineBuiltinModule({
    name: '_channels',
    schema: channelsSchema,
    routes,
  });

  function registerAdapter(name: string, adapter: ChannelAdapter) {
    adapters.set(name, adapter);
    logger.info(`Channel adapter registered: ${name}`);
  }

  return { ...mod, service, emitter, registerAdapter };
}

export { ChannelEventEmitter } from './events';
export { channelsLog, channelsSchema, channelsTemplates } from './schema';
export type { ChannelSend, ChannelsService } from './service';
export { createChannelsService } from './service';
