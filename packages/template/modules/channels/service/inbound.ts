/**
 * Generic inbound dispatcher.
 *
 * Handles four event kinds emitted by channel adapters:
 *   - `message_received` (customer) — persist, seed 24h window, enqueue wake
 *   - `message_received` (echo)     — persist role='staff', no window, no wake
 *   - `status_update`               — advance delivery status FSM
 *   - `reaction`                    — upsert/remove from message_reactions
 *
 * Echo detection: `event.metadata.echo === true` (set by parseWhatsAppEchoes).
 * Echoes persist with role='staff' and never open the 24h window or wake agents.
 */

import type { ChannelInstance } from '@modules/channels/schema'
import { upsertByExternal } from '@modules/contacts/service/contacts'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import { extractEchoMetadata } from '@modules/messaging/service/echo-metadata'
import { updateDeliveryStatus } from '@modules/messaging/service/messages'
import { removeReaction, upsertReaction } from '@modules/messaging/service/reactions'
import { seedOnInbound } from '@modules/messaging/service/sessions'
import type { ChannelEvent, MessageReceivedEvent, ReactionEvent, StatusUpdateEvent } from '@vobase/core'

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

async function handleStatusUpdate(event: StatusUpdateEvent): Promise<void> {
  await updateDeliveryStatus({
    channelExternalId: event.messageId,
    status: event.status,
    errorCode: event.metadata?.errorCode as string | undefined,
    errorMessage: event.metadata?.errorMessage as string | undefined,
  })
}

async function handleReaction(event: ReactionEvent, instance: ChannelInstance): Promise<void> {
  if (event.action === 'remove') {
    await removeReaction({
      messageId: event.messageId,
      fromExternal: event.from,
      emoji: event.emoji,
    })
  } else {
    await upsertReaction({
      messageId: event.messageId,
      channelInstanceId: instance.id,
      fromExternal: event.from,
      emoji: event.emoji,
    })
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
    if (event.type === 'status_update') {
      await handleStatusUpdate(event)
      continue
    }

    if (event.type === 'reaction') {
      await handleReaction(event, instance)
      continue
    }

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

    // Safe projection — never pass raw adapter metadata (may contain PII/provider fields).
    const metadata = extractEchoMetadata(event.metadata)

    // Echo events (smb_message_echoes) arrive with metadata.echo=true — they are
    // messages staff sent via the WhatsApp Business App, not customer inbound.
    const isEcho = metadata.echo === true
    const role = isEcho ? 'staff' : 'customer'

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
      metadata,
      role,
    })

    // Seed the 24h messaging window on customer inbound only (echoes never open it).
    if (!isEcho && adapter?.capabilities.messagingWindow && result.message.role === 'customer') {
      await seedOnInbound(result.conversation.id, instance.id)
    }

    // Echoes never wake the agent — they are staff-authored, not customer-driven.
    if (!isEcho && result.isNew) {
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
