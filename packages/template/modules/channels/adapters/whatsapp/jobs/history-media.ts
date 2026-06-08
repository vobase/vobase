/**
 * Coexistence history media enrichment — `whatsapp:history-media`.
 *
 * The ≤14-day media-asset follow-up (a `messages[]` entry under `field:history`)
 * is enqueued here per image by the webhook interception. The job downloads the
 * asset by id and attaches it to the placeholder message matched by wamid,
 * reusing the live-inbound Drive-ingest + attachment path so the existing
 * renderer shows the image. If the placeholder isn't created yet (the asset
 * webhook can beat its history chunk), it re-enqueues itself with a short delay
 * up to a cap.
 */

import {
  decryptInstanceAccessToken,
  parseWhatsappInstanceConfig,
} from '@modules/channels/adapters/whatsapp/instance-config'
import { fetchWhatsAppMedia, type MetaOAuthConfig } from '@modules/channels/adapters/whatsapp/meta-oauth'
import { getInstance } from '@modules/channels/service/instances'
import { getJobs } from '@modules/channels/service/state'
import { attachHistoricalMedia } from '@modules/messaging/service/conversations'

export const WHATSAPP_HISTORY_MEDIA_JOB = 'whatsapp:history-media'

const MAX_ATTEMPTS = 12
const RETRY_DELAY_MS = 10_000

export interface WhatsappHistoryMediaJobData {
  instanceId: string
  organizationId: string
  wamid: string
  mediaId: string
  mimeType: string | null
  filename: string
  /** Self-re-enqueue counter while the placeholder message isn't created yet. */
  attempt?: number
}

export async function runWhatsappHistoryMediaJob(data: WhatsappHistoryMediaJobData): Promise<void> {
  const instance = await getInstance(data.instanceId)
  if (!instance || instance.organizationId !== data.organizationId) return

  const cfg = parseWhatsappInstanceConfig(instance.config)
  const accessToken = decryptInstanceAccessToken(cfg)
  const oauthConfig: MetaOAuthConfig = {
    appId: cfg.appId ?? '',
    appSecret: cfg.appSecret ?? '',
    apiVersion: cfg.apiVersion ?? 'v22.0',
  }

  let media: { bytes: Buffer; mimeType: string }
  try {
    media = await fetchWhatsAppMedia(data.mediaId, accessToken, oauthConfig)
  } catch (err) {
    console.warn('[whatsapp:history-media] download failed', {
      wamid: data.wamid,
      mediaId: data.mediaId,
      err: err instanceof Error ? err.message : String(err),
    })
    return
  }

  const result = await attachHistoricalMedia({
    organizationId: data.organizationId,
    wamid: data.wamid,
    bytes: media.bytes,
    mimeType: data.mimeType ?? media.mimeType,
    filename: data.filename,
  })

  if (!result.found) {
    // The placeholder message isn't created yet (asset webhook beat its history
    // chunk's drain) — re-enqueue with a short delay until it exists, capped.
    const attempt = (data.attempt ?? 0) + 1
    if (attempt > MAX_ATTEMPTS) {
      console.warn(`[whatsapp:history-media] gave up on ${data.wamid} after ${attempt} attempts (no placeholder)`)
      return
    }
    const jobs = getJobs()
    if (jobs) {
      await jobs
        .send(WHATSAPP_HISTORY_MEDIA_JOB, { ...data, attempt }, { startAfter: new Date(Date.now() + RETRY_DELAY_MS) })
        .catch((err) => console.warn('[whatsapp:history-media] re-enqueue failed:', (err as Error).message))
    }
  }
}
