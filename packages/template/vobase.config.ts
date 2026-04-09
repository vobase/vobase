import { type CreateAppConfig, createSmtpAdapter } from '@vobase/core';

import { devAuth } from './modules/system/dev-auth-plugin';
import { renderInvitationEmail, renderOtpEmail } from './modules/system/emails';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 1025);
const smtpFrom = process.env.SMTP_FROM || 'noreply@vobase.local';

if (!smtpHost) {
  console.warn(
    '⚠ SMTP_HOST is not set — email OTP sign-in will not work. Set SMTP_HOST in .env (use MailDev for local dev).',
  );
}

const smtpAdapter = smtpHost
  ? createSmtpAdapter({
      host: smtpHost,
      port: smtpPort,
      from: smtpFrom,
      ...(process.env.SMTP_USER && {
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || '',
        },
      }),
    })
  : null;

/** Server-side branding. See also: src/lib/branding.ts (client-side equivalent). */
export const productName = process.env.VITE_PRODUCT_NAME || 'Vobase';
export const companyName = process.env.VITE_COMPANY_NAME || 'Vobase';

const config: Omit<CreateAppConfig, 'modules'> = {
  database: databaseUrl,

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

  // --- Auth ---
  auth: {
    appName: productName,
    multiOrg: process.env.MULTI_ORG === 'true',
    teams: true,
    ...(process.env.VITE_ALLOWED_EMAIL_DOMAINS && {
      allowedEmailDomains: process.env.VITE_ALLOWED_EMAIL_DOMAINS.split(
        ',',
      ).map((d) => d.trim()),
    }),
    ...(process.env.NODE_ENV !== 'production' && {
      extraPlugins: [devAuth()],
    }),
    ...(smtpAdapter && {
      sendVerificationOTP: async ({ email, otp, type }) => {
        const html = await renderOtpEmail({ otp, type });
        await smtpAdapter.send({
          to: email,
          subject: `[${productName}] Your sign-in verification code`,
          html,
        });
      },
      sendInvitationEmail: async ({
        email,
        inviterName,
        organizationName,
        invitationId,
      }) => {
        const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:5173';
        const signInUrl = `${baseUrl}/login?invitationId=${invitationId}`;
        const html = await renderInvitationEmail({
          inviterName,
          organizationName,
          signInUrl,
        });
        await smtpAdapter.send({
          to: email,
          subject: `[${productName}] You've been invited to ${organizationName}`,
          html,
        });
      },
    }),
  },

  // --- Channels ---
  channels: {
    ...(smtpAdapter && {
      email: {
        provider: 'smtp' as const,
        from: smtpFrom,
        smtp: {
          host: smtpHost as string,
          port: smtpPort,
        },
      },
    }),
  },

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
