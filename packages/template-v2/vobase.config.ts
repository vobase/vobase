/**
 * vobase.config.ts — registers all 7 modules in dependency order.
 * Order matters for init dependency resolution:
 * contacts → team → drive → messaging → agents → channel-web → channel-whatsapp
 */

import agents from './modules/agents/module'
import channelWeb from './modules/channels/web/module'
import channelWhatsapp from './modules/channels/whatsapp/module'
import contacts from './modules/contacts/module'
import drive from './modules/drive/module'
import messaging from './modules/messaging/module'
import settings from './modules/settings/module'
import team from './modules/team/module'

export default {
  database: process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5433/vobase_v2',

  /** LLM provider config — Anthropic is the Phase 2 critical-path provider. */
  provider: {
    default: (process.env.LLM_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai' | 'gemini' | 'mock',
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    },
    /** Stretch — Phase 2.5 */
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
    },
    /** Stretch — Phase 2.5 */
    gemini: {
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
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

  modules: [settings, contacts, team, drive, messaging, agents, channelWeb, channelWhatsapp],
}
