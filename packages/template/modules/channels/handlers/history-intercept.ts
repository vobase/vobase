/**
 * Coexistence `history` webhook interception.
 *
 * Runs in the webhook POST handler AFTER signature verification and BEFORE the
 * adapter's `parseWebhook`. When the body carries any `field:"history"` change
 * it captures each `history[]` element to the staging table, kicks the drain
 * job, and reports "handled" so the caller acks 200 without ever routing the
 * payload through the live inbound path. This is essential because the core
 * adapter parses `value.messages` regardless of `field`, so the ≤14-day
 * media-asset follow-up (which rides `messages[]` under `field:history`) would
 * otherwise be treated as a brand-new live inbound and wake the agent.
 */

import {
  WHATSAPP_HISTORY_DRAIN_JOB,
  type WhatsappHistoryDrainJobData,
} from '@modules/channels/adapters/whatsapp/jobs/history-drain'
import {
  WHATSAPP_HISTORY_MEDIA_JOB,
  type WhatsappHistoryMediaJobData,
} from '@modules/channels/adapters/whatsapp/jobs/history-media'
import { parseHistoryMediaAssets } from '@modules/channels/adapters/whatsapp/parse-history'
import type { ChannelInstance } from '@modules/channels/schema'
import { type StageHistoryChunkInput, stageHistoryChunks } from '@modules/channels/service/history-staging'
import { getJobs } from '@modules/channels/service/state'

interface RawHistoryElement {
  metadata?: { phase?: number; chunk_order?: number; progress?: number }
  errors?: unknown[]
}
interface RawHistoryValue {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  history?: RawHistoryElement[]
}
interface RawBody {
  object?: string
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: RawHistoryValue }> }>
}

/**
 * @returns `true` when the webhook was a coexistence history webhook (and has
 * been staged / swallowed); `false` to let the normal adapter path run.
 */
export async function interceptHistoryWebhook(instance: ChannelInstance, request: Request): Promise<boolean> {
  if (instance.channel !== 'whatsapp' && instance.channel !== 'whatsapp_notif') return false

  let body: RawBody
  try {
    body = (await request.clone().json()) as RawBody
  } catch {
    return false
  }
  if (body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return false

  const rows: StageHistoryChunkInput[] = []
  let sawHistoryField = false
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'history') continue
      sawHistoryField = true
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id ?? ''
      for (const element of value?.history ?? []) {
        const meta = element.metadata ?? {}
        rows.push({
          organizationId: instance.organizationId,
          channelInstanceId: instance.id,
          phase: meta.phase ?? 0,
          chunkOrder: meta.chunk_order ?? 0,
          progress: meta.progress ?? 0,
          phoneNumberId,
          declined: Array.isArray(element.errors) && element.errors.length > 0,
          // Re-wrap the single element as a standalone history webhook so the
          // drain hands it straight to `parseWhatsAppHistory`.
          payload: {
            object: 'whatsapp_business_account',
            entry: [
              {
                id: entry.id,
                changes: [
                  {
                    field: 'history',
                    value: { messaging_product: 'whatsapp', metadata: value?.metadata, history: [element] },
                  },
                ],
              },
            ],
          },
        })
      }
    }
  }

  // A history webhook with no `history[]` elements (e.g. the media-asset
  // follow-up, which rides `messages[]`) is still "handled" — swallowed so it
  // never reaches the live inbound path — but stages nothing.
  if (!sawHistoryField) return false

  if (rows.length > 0) {
    await stageHistoryChunks(rows)
    const jobs = getJobs()
    if (jobs) {
      const jobData: WhatsappHistoryDrainJobData = {
        instanceId: instance.id,
        organizationId: instance.organizationId,
      }
      void jobs.send(WHATSAPP_HISTORY_DRAIN_JOB, jobData).catch((err) => {
        console.error('[wa-history] drain enqueue failed:', (err as Error).message)
      })
    }
  }

  // ≤14-day media-asset follow-ups ride `messages[]` under `field:history` —
  // enqueue a download+attach job per image (it retries until its placeholder
  // message has been created by the drain).
  const mediaAssets = parseHistoryMediaAssets(body)
  if (mediaAssets.length > 0) {
    const jobs = getJobs()
    if (jobs) {
      for (const asset of mediaAssets) {
        const mediaJob: WhatsappHistoryMediaJobData = {
          instanceId: instance.id,
          organizationId: instance.organizationId,
          wamid: asset.wamid,
          mediaId: asset.mediaId,
          mimeType: asset.mimeType,
          filename: asset.filename,
        }
        void jobs.send(WHATSAPP_HISTORY_MEDIA_JOB, mediaJob).catch((err) => {
          console.error('[wa-history] media job enqueue failed:', (err as Error).message)
        })
      }
    }
  }

  return true
}
