import type { CreateAppConfig } from '@vobase/core';

const config: Omit<CreateAppConfig, 'modules'> = {
  database: './data/vobase.db',
  storage: { basePath: './data/files' },
  mcp: { enabled: true },
  trustedOrigins: ['http://localhost:5173'],

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
