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
import { triggerCoexistenceSyncs } from '@modules/channels/adapters/whatsapp/coexistence-sync'
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

  // Hoisted out of the try so a successful smb_app_data sync's once-only guard
  // is persisted even when finalization (marking the instance active) fails —
  // otherwise a /finish retry would re-fire the already-succeeded sync and Meta
  // would error on the duplicate call.
  let coexistenceConfigPatch: Record<string, unknown> | undefined

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

    // Coexistence only: now that the WABA is subscribed (its webhooks route to
    // this tenant via the override callback), fire the one-time history +
    // contacts SMB App Data syncs and persist the once-only guard timestamps.
    // Sync failures are non-fatal — logged and left re-fireable, never failing
    // setup, since the channel itself is connected.
    if (cfg.coexistence) {
      const outcome = await triggerCoexistenceSyncs(cfg, accessToken)
      if (outcome.failures.length > 0) {
        console.warn('[whatsapp:setup] coexistence SMB App Data sync had failures', {
          instanceId: instance.id,
          failures: outcome.failures,
        })
      }
      coexistenceConfigPatch = { ...instance.config, coexistenceHistory: outcome.coexistenceHistory }
    }

    await updateInstance(instance.id, instance.organizationId, {
      setupStage: 'active',
      status: 'active',
      lastError: null,
      ...(coexistenceConfigPatch ? { config: coexistenceConfigPatch } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateInstance(instance.id, instance.organizationId, {
      setupStage: 'failed',
      lastError: message.slice(0, 500),
      // Preserve any once-only guard timestamps collected before the failure so
      // a retry doesn't re-fire an already-succeeded smb_app_data sync.
      ...(coexistenceConfigPatch ? { config: coexistenceConfigPatch } : {}),
    })
    // Don't rethrow — failure is surfaced via `lastError`. Letting the queue
    // retry would just re-hit Meta and re-fail until the operator intervenes.
  }
}

function generateRegistrationPin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}
