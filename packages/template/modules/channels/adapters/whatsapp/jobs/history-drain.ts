/**
 * Coexistence history drain — `whatsapp:history-drain`.
 *
 * Reads unprocessed `whatsapp_history_chunks` for an instance, parses each via
 * `parseWhatsAppHistory`, resolves the contact per thread, backfills into the
 * inbox via `backfillHistoricalMessages`, marks the chunk processed, then
 * advances the instance sync status. Out-of-order safe and message-idempotent
 * (backfill dedupes on the WhatsApp message id), so re-running is harmless.
 */

import { parseWhatsAppHistory } from '@modules/channels/adapters/whatsapp/parse-history'
import { listUnprocessedHistoryChunks, markHistoryChunksProcessed } from '@modules/channels/service/history-staging'
import { getInstance, updateInstance } from '@modules/channels/service/instances'
import { upsertByExternalKey } from '@modules/contacts/service/contacts'
import { normalizePhoneE164 } from '@modules/contacts/service/identity-normalize'
import { backfillHistoricalMessages, resolveImportedHistory } from '@modules/messaging/service/conversations'
import type { BackfillHistoryMessage } from '@modules/messaging/service/types'

export const WHATSAPP_HISTORY_DRAIN_JOB = 'whatsapp:history-drain'

export interface WhatsappHistoryDrainJobData {
  instanceId: string
  organizationId: string
}

function toContentType(messageType: string): BackfillHistoryMessage['contentType'] {
  switch (messageType) {
    case 'text':
    case 'image':
    case 'document':
    case 'audio':
    case 'video':
      return messageType
    default:
      return 'unsupported'
  }
}

export async function runWhatsappHistoryDrainJob(data: WhatsappHistoryDrainJobData): Promise<void> {
  const instance = await getInstance(data.instanceId)
  if (!instance || instance.organizationId !== data.organizationId) return

  // Drain in bounded passes so a large 180-day burst (many chunks, each a big
  // JSONB payload) is never all held in memory at once. Each pass marks its
  // successes processed; a pass that makes zero progress (every chunk in it
  // failed) breaks to avoid a hot loop, leaving those chunks for a later drain.
  const CHUNK_BATCH = 25
  let drainedAny = false
  let maxProgress = 0
  let declinedSeen = false

  let chunks = await listUnprocessedHistoryChunks(data.instanceId, CHUNK_BATCH)
  while (chunks.length > 0) {
    drainedAny = true
    const processedIds: string[] = []

    for (const chunk of chunks) {
      try {
        for (const parsed of parseWhatsAppHistory(chunk.payload)) {
          if (parsed.progress > maxProgress) maxProgress = parsed.progress
          if (parsed.declined) declinedSeen = true

          // Group a chunk's messages by customer phone (= thread) → one contact
          // upsert + one backfill call per contact.
          const byPhone = new Map<string, typeof parsed.messages>()
          for (const m of parsed.messages) {
            const list = byPhone.get(m.customerPhone) ?? []
            list.push(m)
            byPhone.set(m.customerPhone, list)
          }

          for (const [phone, msgs] of byPhone) {
            const canonical = normalizePhoneE164(phone) || phone
            const contact = await upsertByExternalKey({
              organizationId: data.organizationId,
              channel: 'whatsapp',
              externalKey: canonical,
              phone: canonical,
            })
            const backfillMessages: BackfillHistoryMessage[] = msgs.map((m) => ({
              wamid: m.wamid,
              content: m.isMediaPlaceholder ? '[media]' : m.content,
              contentType: toContentType(m.messageType),
              role: m.direction === 'outbound' ? 'staff' : 'customer',
              occurredAt: new Date(m.timestampMs),
              // Business-sent history messages were typed in the WhatsApp Business
              // App; Meta gives us only the business phone, never the staffer. Tag
              // them like a live coexistence echo so the UI renders a generic
              // "Staff" identity instead of mis-attributing to the first staff
              // member in the directory (message-thread.tsx::messagePrincipal).
              ...(m.direction === 'outbound'
                ? { metadata: { echoSource: 'business_app' as const, direction: 'outbound' as const } }
                : {}),
            }))
            await backfillHistoricalMessages({
              organizationId: data.organizationId,
              channelInstanceId: data.instanceId,
              contactId: contact.id,
              messages: backfillMessages,
            })
          }
        }
        processedIds.push(chunk.id)
      } catch (err) {
        console.error('[whatsapp:history-drain] chunk parse/backfill failed', {
          instanceId: data.instanceId,
          chunkId: chunk.id,
          err: err instanceof Error ? err.message : String(err),
        })
        // Leave the chunk unprocessed so a later drain retries it; keep going.
      }
    }

    if (processedIds.length > 0) await markHistoryChunksProcessed(processedIds)

    // No chunk in this pass succeeded → stop rather than re-loading the same
    // failing chunks forever; a later drain retries them.
    if (processedIds.length === 0) break
    // A short pass means the queue is drained.
    if (chunks.length < CHUNK_BATCH) break
    chunks = await listUnprocessedHistoryChunks(data.instanceId, CHUNK_BATCH)
  }

  if (drainedAny) {
    // Advance the per-instance sync status (drives the UI chip). 'imported' —
    // which unlocks the bulk resolve — requires BOTH that Meta reported
    // progress=100 AND that no unprocessed chunks remain, so a chunk that failed
    // to backfill keeps the import 'importing' and defers the resolve until it
    // lands. Progress is max(this drain, persisted) so a late straggler chunk
    // can't regress it, and a recorded 'declined' is never overwritten.
    const cfg = instance.config as Record<string, unknown>
    const prev = (cfg.coexistenceHistory as Record<string, unknown> | undefined) ?? {}
    const prevProgress = typeof prev.progress === 'number' ? prev.progress : 0
    const effectiveProgress = Math.max(maxProgress, prevProgress)
    const stillPending = await listUnprocessedHistoryChunks(data.instanceId, 1)
    const status =
      declinedSeen || prev.status === 'declined'
        ? 'declined'
        : effectiveProgress >= 100 && stillPending.length === 0
          ? 'imported'
          : 'importing'
    await updateInstance(instance.id, instance.organizationId, {
      config: { ...cfg, coexistenceHistory: { ...prev, status, progress: effectiveProgress } },
    }).catch((err) => {
      console.warn('[whatsapp:history-drain] sync-status update failed:', (err as Error).message)
    })
  }

  // Bulk-resolve the backfilled threads so 6 months of dead history doesn't
  // flood the live inbox. Self-gates on the freshly-written status, so this is a
  // no-op until the import completes. Reachable even when no chunks drained this
  // pass (e.g. a media-asset follow-up drain) so a resolve that failed on an
  // earlier pass is retried instead of the flood being silently reinstated.
  await resolvePendingImportedHistory(data.instanceId, data.organizationId)
}

/**
 * Resolve the backfilled history threads once the import is complete, guarded by
 * a persisted `coexistenceHistory.historyResolved` flag. Re-reads the instance
 * so it sees the just-written status, runs `resolveImportedHistory` at most once
 * (the flag is set only after success), and stays retryable on failure — the
 * next drain re-attempts it. Non-fatal: a failure logs at error level and is
 * picked up by a later drain rather than failing the data import itself.
 */
async function resolvePendingImportedHistory(instanceId: string, organizationId: string): Promise<void> {
  const instance = await getInstance(instanceId)
  if (!instance || instance.organizationId !== organizationId) return
  const cfg = instance.config as Record<string, unknown>
  const hist = (cfg.coexistenceHistory as Record<string, unknown> | undefined) ?? {}
  if (hist.status !== 'imported' || hist.historyResolved === true) return

  try {
    const res = await resolveImportedHistory({ organizationId, channelInstanceId: instanceId })
    await updateInstance(instanceId, organizationId, {
      config: { ...cfg, coexistenceHistory: { ...hist, historyResolved: true } },
    })
    console.info('[whatsapp:history-drain] resolved imported history', { instanceId, ...res })
  } catch (err) {
    // Leave `historyResolved` unset so the next drain retries; surface loudly.
    console.error('[whatsapp:history-drain] resolveImportedHistory failed; will retry on next drain', {
      instanceId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
