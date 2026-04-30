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
 * channels share a single wake job name (`channels:inbound-to-wake`); the
 * wake handler is registered in `runtime/bootstrap.ts`.
 */

import type { ChannelInstance } from '@modules/channels/schema'
import { upsertByExternal } from '@modules/contacts/service/contacts'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import type { ChannelEvent, MessageReceivedEvent } from '@vobase/core'

import { INBOUND_TO_WAKE_JOB } from '~/wake/inbound'
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

    const result = await createInboundMessage({
      organizationId: instance.organizationId,
      channelInstanceId: instance.id,
      contactId: contact.id,
      externalMessageId: event.messageId,
      content: event.content,
      contentType: toContentType(event.messageType),
      profileName: event.profileName,
      initialAssignee: opts?.defaultAssignee ?? null,
    })

    if (result.isNew) {
      await jobs.send(INBOUND_TO_WAKE_JOB, {
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
