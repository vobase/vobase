/**
 * Generic inbound dispatcher.
 *
 * Takes a `ChannelEvent` (from `@vobase/core`) plus the resolved
 * `channel_instances` row and:
 *   1. Upserts the contact via contacts service
 *   2. Persists the message via messaging service (idempotent on externalMessageId)
 *   3. Enqueues a wake job if the conversation is new (i.e. an agent should run)
 *
 * Adapter handlers parse webhooks then hand normalized events here. All
 * channels share a single wake job name (`agents:wake`); the wake handler
 * is registered in `runtime/bootstrap.ts`.
 */

import type { ChannelInstance } from '@modules/channels/schema'
import { upsertByExternal } from '@modules/contacts/service/contacts'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import type { ChannelEvent, MessageReceivedEvent } from '@vobase/core'

import { AGENTS_WAKE_JOB } from '~/wake/inbound'
import { get as registryGet } from './registry'
import { requireJobs } from './state'

export interface InboundDispatchResult {
  externalMessageId: string
  conversationId: string
  messageId: string
  isNew: boolean
}

/** Map a core `MessageReceivedEvent.messageType` onto the messaging contentType vocabulary. */
function toContentType(
  t: MessageReceivedEvent['messageType'],
): import('~/runtime/channel-events').ChannelInboundEvent['contentType'] {
  switch (t) {
    case 'text':
    case 'image':
    case 'document':
    case 'audio':
    case 'video':
    case 'button_reply':
    case 'list_reply':
      return t
    default:
      return 'unsupported'
  }
}

export async function dispatchInbound(
  events: ChannelEvent[],
  instance: ChannelInstance,
  opts?: { defaultAssignee?: string | null },
): Promise<InboundDispatchResult[]> {
  const results: InboundDispatchResult[] = []
  const jobs = requireJobs()

  for (const event of events) {
    if (event.type !== 'message_received') continue

    const externalKey = `${instance.channel}:${event.from}`
    const contact = await upsertByExternal({
      organizationId: instance.organizationId,
      phone: externalKey,
      displayName: event.profileName || undefined,
    })

    // Forward inbound media bytes through the trust-bounded attachments[]
    // seam. The channel adapter (e.g. WA) eagerly downloaded these via
    // `cachedDownloader` and dropped any oversized items already; the seam
    // is documented on `CreateInboundMessageInput.attachments`.
    const attachments = event.media
      ?.filter((m) => m.data && (m.sizeBytes ?? m.data.length) > 0)
      .map((m, idx) => ({
        bytes: m.data,
        name: m.filename ?? `${event.messageId}-${idx}`,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes ?? m.data.length,
      }))

    const adapter = registryGet(instance.channel, instance.config, instance.id)
    const threadKey = adapter?.resolveThreadKey?.(event) ?? 'default'

    const result = await createInboundMessage({
      organizationId: instance.organizationId,
      channelInstanceId: instance.id,
      contactId: contact.id,
      externalMessageId: event.messageId,
      content: event.content,
      contentType: toContentType(event.messageType),
      profileName: event.profileName,
      initialAssignee: opts?.defaultAssignee ?? null,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      threadKey,
    })

    if (result.isNew) {
      await jobs.send(AGENTS_WAKE_JOB, {
        organizationId: instance.organizationId,
        conversationId: result.conversation.id,
        messageId: result.message.id,
        contactId: contact.id,
      })
    }

    results.push({
      externalMessageId: event.messageId,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      isNew: result.isNew,
    })
  }

  return results
}
