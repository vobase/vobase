/**
 * vobase.config.ts — registers all modules in dependency order.
 * Order matters for init dependency resolution:
 * settings → contacts → team → drive → messaging → agents → channel-web →
 * channel-whatsapp → system.
 *
 * Channels are first-class modules now: each `modules/channel-<name>/module.ts`
 * mounts its routes via `web.routes` and installs its services in `init(ctx)`.
 */

import agents from './modules/agents/module'
import channelWeb from './modules/channel-web/module'
import channelWhatsapp from './modules/channel-whatsapp/module'
import contacts from './modules/contacts/module'
import drive from './modules/drive/module'
import messaging from './modules/messaging/module'
import settings from './modules/settings/module'
import system from './modules/system/module'
import team from './modules/team/module'

export default {
  database: process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5433/vobase_v2',

  /** LLM provider config — Anthropic is the only wired provider. */
  provider: {
    default: (process.env.LLM_PROVIDER ?? 'anthropic') as 'anthropic' | 'mock',
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    },
  },

  /**
   * Storage adapter — local filesystem for dev, Cloudflare R2 (S3-compatible)
   * for production. Standalone deployments can override by setting R2_*.
   */
  storage: process.env.R2_BUCKET
    ? {
        type: 's3' as const,
        bucket: process.env.R2_BUCKET,
        endpoint: process.env.R2_ENDPOINT ?? '',
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      }
    : { type: 'local' as const, basePath: process.env.STORAGE_LOCAL_PATH ?? './data/files' },

  buckets: {
    uploads: { access: 'private' as const },
    'kb-documents': { access: 'private' as const },
    'chat-attachments': { access: 'private' as const },
  },

  /** Channel config — web is always enabled; whatsapp is opt-in via env. */
  channels: {
    web: {
      enabled: true,
    },
    whatsapp: {
      enabled: !!(process.env.META_WA_TOKEN && process.env.META_WA_VERIFY_TOKEN),
      token: process.env.META_WA_TOKEN ?? '',
      verifyToken: process.env.META_WA_VERIFY_TOKEN ?? '',
      phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID ?? '',
    },
  },

  modules: [settings, contacts, team, drive, messaging, agents, channelWeb, channelWhatsapp, system],
}
