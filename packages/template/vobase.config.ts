import type { CreateAppConfig } from '@vobase/core';

const config: Omit<CreateAppConfig, 'modules'> = {
  database: './data/vobase.db',
  storage: {
    provider: { type: 'local', basePath: './data/files' },
    buckets: {
      uploads: { access: 'private' },
      'kb-documents': { access: 'private' },
      'chat-attachments': { access: 'private' },
    },
  },
  credentials: { enabled: true },
  mcp: { enabled: true },
  trustedOrigins: ['http://localhost:5173'],

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
