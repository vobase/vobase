/**
 * Post-ESU finalization job — `whatsapp:setup`.
 *
 * Triggered after `/signup/exchange` (or replayed manually via `/finish`).
 * Three upstream calls in order:
 *   1. Subscribe the configured Meta app to the WABA's webhooks.
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
  loadMetaOAuthConfigFromEnv,
  parseWhatsappInstanceConfig,
} from '@modules/channels/adapters/whatsapp/instance-config'
import { registerPhoneNumber, subscribeAppToWaba } from '@modules/channels/adapters/whatsapp/meta-oauth'
import { getInstance, updateInstance } from '@modules/channels/service/instances'

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
    const oauthConfig = loadMetaOAuthConfigFromEnv()

    // Subscribe + register are independent Meta calls — run in parallel to
    // halve the job's wall-clock time on Cloud-API setup.
    const subscribe = subscribeAppToWaba(cfg.wabaId, accessToken, oauthConfig)
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
