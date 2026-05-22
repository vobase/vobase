/**
 * Post-ESU finalization job — `whatsapp:setup`.
 *
 * Triggered after `/signup/exchange` (or replayed manually via `/finish`).
 * Three upstream calls in order:
 *   1. Subscribe the Meta app to the WABA's webhooks. When the instance row
 *      carries a `webhookVerifyToken`, a per-WABA `override_callback_uri` is
 *      set so webhooks route to THIS tenant — required for WABAs onboarded
 *      through the platform's shared Meta app.
 *   2. For Cloud-API mode (not coexistence): register the phone number with a
 *      6-digit PIN. Coexistence skips this — the number is already registered
 *      via the WhatsApp Business App.
 *   3. Mark the channel instance `setupStage='active', status='active'`.
 *
 * On any failure: write `setupStage='failed', lastError=…` so the admin UI
 * can surface a retry CTA. The job itself is idempotent: re-running after
 * partial success is safe (Meta returns success on duplicate subscribe).
 */

import { randomInt } from 'node:crypto'
import {
  decryptInstanceAccessToken,
  parseWhatsappInstanceConfig,
} from '@modules/channels/adapters/whatsapp/instance-config'
import {
  type MetaOAuthConfig,
  registerPhoneNumber,
  subscribeAppToWaba,
} from '@modules/channels/adapters/whatsapp/meta-oauth'
import { getInstance, updateInstance } from '@modules/channels/service/instances'

import { readAppBaseUrl } from '~/runtime/app-url'

export const WHATSAPP_SETUP_JOB = 'whatsapp:setup'

export interface WhatsappSetupJobData {
  instanceId: string
  organizationId: string
}

export async function runWhatsappSetupJob(data: WhatsappSetupJobData): Promise<void> {
  const instance = await getInstance(data.instanceId)
  if (!instance) return
  if (instance.organizationId !== data.organizationId) {
    throw new Error(`whatsapp:setup: org mismatch for instance ${data.instanceId}`)
  }

  try {
    const cfg = parseWhatsappInstanceConfig(instance.config)
    const accessToken = decryptInstanceAccessToken(cfg)

    // Build the Meta API config from the instance row, not env: a
    // platform-handoff instance runs against the platform's Meta app and the
    // tenant carries no META_APP_* env vars. apiVersion is the only field the
    // subscribe/register calls consult.
    const oauthConfig: MetaOAuthConfig = {
      appId: cfg.appId ?? '',
      appSecret: cfg.appSecret ?? '',
      apiVersion: cfg.apiVersion ?? 'v22.0',
    }

    // Route this WABA's webhooks to THIS tenant via a per-WABA override
    // callback. Without it, a WABA onboarded through the platform's shared
    // Meta app delivers webhooks to the platform's app-level URL. Skipped for
    // legacy rows with no verify token (tenant owns the app — its app-level
    // callback already points here).
    const subscribeOptions = cfg.webhookVerifyToken
      ? {
          overrideCallbackUri: `${readAppBaseUrl()}/api/channels/webhook/whatsapp/${instance.id}`,
          verifyToken: cfg.webhookVerifyToken,
        }
      : undefined

    // Subscribe + register are independent Meta calls — run in parallel to
    // halve the job's wall-clock time on Cloud-API setup.
    const subscribe = subscribeAppToWaba(cfg.wabaId, accessToken, oauthConfig, subscribeOptions)
    const register =
      cfg.coexistence !== true && cfg.phoneNumberId
        ? registerPhoneNumber(cfg.phoneNumberId, generateRegistrationPin(), accessToken, oauthConfig)
        : Promise.resolve()
    await Promise.all([subscribe, register])

    await updateInstance(instance.id, instance.organizationId, {
      setupStage: 'active',
      status: 'active',
      lastError: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateInstance(instance.id, instance.organizationId, {
      setupStage: 'failed',
      lastError: message.slice(0, 500),
    })
    // Don't rethrow — failure is surfaced via `lastError`. Letting the queue
    // retry would just re-hit Meta and re-fail until the operator intervenes.
  }
}

function generateRegistrationPin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}
