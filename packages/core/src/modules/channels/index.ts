import { Hono } from 'hono';

import type { ChannelAdapter } from '../../contracts/channels';
import { defineBuiltinModule } from '../../module';
import { logger } from '../../infra/logger';
import { ChannelEventEmitter } from './events';
import { createChannelsService } from './service';
import { channelsSchema } from './schema';
import type { VobaseDb } from '../../db/client';

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

export function createChannelsModule(db: VobaseDb, config: ChannelsModuleConfig) {
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
      return c.json({ error: `Channel ${channelName} does not support push inbound` }, 400);
    }

    // Verify webhook signature
    const isValid = await adapter.verifyWebhook(c.req.raw);
    if (!isValid) {
      logger.warn('Webhook signature verification failed', { channel: channelName });
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Parse and emit events (non-blocking — return 200 immediately)
    const request = c.req.raw;
    Promise.resolve()
      .then(async () => {
        const events = await adapter.parseWebhook!(request);
        for (const event of events) {
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

export { channelsLog, channelsTemplates, channelsSchema } from './schema';
export { createChannelsService } from './service';
export type { ChannelsService, ChannelSend } from './service';
export { ChannelEventEmitter } from './events';
