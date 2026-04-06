import {
  type CreateAppConfig,
  createNanoid,
  createWhatsAppAdapter,
} from '@vobase/core';

import { reinitChat } from './modules/ai/lib/chat-init';
import { getModuleDeps } from './modules/ai/lib/deps';
import { channelInstances } from './modules/ai/schema';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const generateId = createNanoid();

const config: Omit<CreateAppConfig, 'modules'> = {
  database: databaseUrl,

  onProvisionChannel: async (data, ctx) => {
    const instanceId = generateId();
    await ctx.db.insert(channelInstances).values({
      id: instanceId,
      type: data.type,
      label: data.label,
      source: data.source,
      integrationId: data.integrationId ?? null,
      config: data.config ?? {},
      status: 'active',
    });

    // Hot-register the channel adapter from platform-stored credentials
    if (data.type === 'whatsapp') {
      const integration = await ctx.integrations.getActive('whatsapp');
      if (integration) {
        const { phoneNumberId, accessToken, appSecret } =
          integration.config as {
            phoneNumberId: string;
            accessToken: string;
            appSecret: string;
          };
        ctx.channels.registerAdapter(
          'whatsapp',
          createWhatsAppAdapter({ phoneNumberId, accessToken, appSecret }),
        );
      }
    }

    await reinitChat({
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
      realtime: getModuleDeps().realtime,
    });
    return { instanceId };
  },
  storage: {
    provider: { type: 'local', basePath: './data/files' },
    buckets: {
      uploads: { access: 'private' },
      'kb-documents': { access: 'private' },
      'chat-attachments': { access: 'private' },
    },
    ...(process.env.PLATFORM_HMAC_SECRET && {
      integrationProvider: 'cloudflare-r2',
    }),
  },
  mcp: { enabled: true },
  trustedOrigins: ['http://localhost:5173', 'http://localhost:5174'],

  // --- Auth plugins ---
  // auth: {
  //   organization: true,  // Enable multi-tenant org/member/role support
  // },

  // --- Outbound HTTP client (ctx.http) ---
  // http: {
  //   timeout: 10_000,
  //   retries: 3,
  //   retryDelay: 500,
  //   circuitBreaker: { threshold: 5, resetTimeout: 30_000 },
  // },

  // --- Inbound webhooks (ctx.webhooks) ---
  // webhooks: {
  //   'stripe-events': {
  //     path: '/webhooks/stripe',
  //     secret: process.env.STRIPE_WEBHOOK_SECRET!,
  //     handler: 'system:processWebhook',
  //     signatureHeader: 'stripe-signature',
  //     dedup: true,
  //   },
  // },
};

export default config;
