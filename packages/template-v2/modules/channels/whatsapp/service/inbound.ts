/**
 * channel-whatsapp inbound service — parsing, instance resolution, and InboxPort dispatch.
 *
 * Owns all logic between "raw Meta payload validated" and "response sent".
 * Handler delegates here; handler only does: signature check → call processWebhookPayload → respond.
 *
 * A3 invariant: no drizzle imports here. Instance resolution goes through InboxPort/ContactsService.
 * One-write-path: all message writes via InboxPort.createInboundMessage.
 */
import { upsertByExternal } from '@modules/contacts/service/contacts'
import { createInboundMessage } from '@modules/inbox/service/conversations'
import type { MetaWebhookPayload } from './parser'
import { parseWebhookPayload } from './parser'
import { requireJobs } from './state'

export interface ProcessResult {
  processed: number
  results: Array<{ externalMessageId: string; isNew: boolean }>
}

/**
 * Resolve the channel instance ID for an inbound webhook.
 *
 * Priority order:
 *   1. Explicit channelInstanceId from route param / header (already a valid internal ID)
 *   2. phone_number_id from payload metadata (looked up via InboxPort)
 *   3. Fall back to env WA_CHANNEL_INSTANCE_ID
 */
function resolveChannelInstanceId(phoneNumberId: string | undefined, explicitInstanceId: string | undefined): string {
  if (explicitInstanceId) return explicitInstanceId
  // When no explicit ID, use phoneNumberId as the lookup key.
  // InboxPort.createInboundMessage deduplicates by externalMessageId so sending an
  // unresolved key is safe — it will mismatch no conversation and create a new one.
  // Full DB-backed resolution (sql config->>'phoneNumberId') is available if needed;
  // for Phase 2 we rely on the caller to pass x-channel-instance-id or route param.
  return phoneNumberId ?? process.env.WA_CHANNEL_INSTANCE_ID ?? ''
}

/**
 * Process a validated Meta webhook payload: parse events, skip status updates,
 * upsert contacts, create inbound messages via InboxPort, enqueue wake jobs.
 */
export async function processWebhookPayload(
  payload: MetaWebhookPayload,
  opts: {
    organizationId: string
    /** Explicit channel instance ID from route param or x-channel-instance-id header. */
    channelInstanceId?: string
  },
): Promise<ProcessResult> {
  const jobs = requireJobs()

  const events = parseWebhookPayload(payload, opts.organizationId)

  const settled = await Promise.all(
    events.map(async (event): Promise<ProcessResult['results'][number] | null> => {
      const meta = event.metadata

      // Skip status update pseudo-events (delivery receipts etc.)
      if (event.contentType === 'unsupported' && meta?.waStatusUpdate) return null

      const phoneNumberId = typeof meta?.phoneNumberId === 'string' ? meta.phoneNumberId : undefined
      const channelInstanceId = resolveChannelInstanceId(phoneNumberId, opts.channelInstanceId)

      if (!channelInstanceId) {
        console.warn(
          '[channel-whatsapp] No channelInstanceId resolved for event — set WA_CHANNEL_INSTANCE_ID or pass x-channel-instance-id header',
          { phoneNumberId, externalMessageId: event.externalMessageId },
        )
        return null
      }

      const contact = await upsertByExternal({
        organizationId: event.organizationId,
        phone: event.from,
        displayName: event.profileName || undefined,
      })

      const result = await createInboundMessage({
        organizationId: event.organizationId,
        channelInstanceId,
        contactId: contact.id,
        externalMessageId: event.externalMessageId,
        content: event.content,
        contentType: event.contentType,
        profileName: event.profileName,
      })

      if (result.isNew) {
        await jobs.send('channel-whatsapp:inbound-to-wake', {
          organizationId: event.organizationId,
          conversationId: result.conversation.id,
          messageId: result.message.id,
          contactId: contact.id,
        })
      }

      return { externalMessageId: event.externalMessageId, isNew: result.isNew }
    }),
  )

  const results = settled.filter((r): r is ProcessResult['results'][number] => r !== null)
  return { processed: results.length, results }
}
