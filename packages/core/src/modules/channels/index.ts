import { Hono } from 'hono';

import type { ChannelAdapter } from '../../contracts/channels';
import type { VobaseDb } from '../../db/client';
import { logger } from '../../infra/logger';
import { defineBuiltinModule } from '../../module';
import { ChannelEventEmitter } from './events';
import { channelsSchema } from './schema';
import { createChannelsService } from './service';

// ─── Config ─────────────────────────────────────────────────────────

export interface WhatsAppChannelConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  apiVersion?: string;
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

  routes.post('/webhook/:channel', async (c) => {
    const channelName = c.req.param('channel');
    const adapter = adapters.get(channelName);

    if (!adapter) {
      return c.json({ error: `Unknown channel: ${channelName}` }, 404);
    }

    if (!adapter.verifyWebhook || !adapter.parseWebhook) {
      return c.json(
        { error: `Channel ${channelName} does not support push inbound` },
        400,
      );
    }

    // Verify webhook signature.
    // Platform-proxied webhooks include X-Platform-Signature but NOT the provider's
    // own signature header (e.g., X-Hub-Signature-256 for WhatsApp). We use the
    // absence of the provider signature to determine if this is a platform-proxied
    // request — this prevents an attacker who compromised the platform secret from
    // bypassing provider-specific verification on direct webhooks.
    const platformSig = c.req.header('x-platform-signature');
    const providerSig = c.req.header('x-hub-signature-256') // WhatsApp/Meta
      || c.req.header('stripe-signature'); // Stripe (extensible)
    let isValid = false;
    let viaPlatform = false;

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
        channel: channelName,
        viaPlatform,
      });
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Parse and emit events (non-blocking — return 200 immediately)
    const request = c.req.raw;
    Promise.resolve()
      .then(async () => {
        const events = await adapter.parseWebhook?.(request);
        for (const event of events ?? []) {
          emitter.emit(event);
        }
      })
      .catch((error) => {
        logger.error('Webhook processing error', {
          channel: channelName,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return c.json({ success: true });
  });

  routes.get('/webhook/:channel', (c) => {
    const channelName = c.req.param('channel');
    const adapter = adapters.get(channelName);

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
