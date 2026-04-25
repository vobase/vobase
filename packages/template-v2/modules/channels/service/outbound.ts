/**
 * Generic outbound dispatcher.
 *
 * The wake worker emits `ChannelOutboundEvent`s; this dispatcher persists the
 * agent message via `messaging.service.messages` (one-write-path), then
 * resolves the channel adapter via the registry and calls `adapter.send()` to
 * push it onto the wire. Adapters whose `send()` is just realtime push (web)
 * still go through the same path so the per-channel wiring stays uniform.
 */

import { getInstance } from '@modules/channels/service/instances'
import { get as getContact } from '@modules/contacts/service/contacts'
import type { Message } from '@modules/messaging/schema'
import { get as getConversation } from '@modules/messaging/service/conversations'
import {
  appendCardMessage,
  appendMediaMessage,
  appendStaffTextMessage,
  appendTextMessage,
} from '@modules/messaging/service/messages'
import type { OutboundMessage, SendResult } from '@vobase/core'
import { nanoid } from 'nanoid'

import type { ChannelOutboundEvent } from '~/runtime/channel-events'
import { get as registryGet } from './registry'

export interface DispatchResult {
  messageId: string
  send: SendResult
}

function toolCtx(wakeId: string) {
  return { wakeId, toolCallId: `wake-${nanoid(8)}`, turnIndex: 0 }
}

function persistMessage(event: ChannelOutboundEvent): Promise<Message> {
  const ctx = toolCtx(event.wakeId)
  const agentId = `wake:${event.wakeId}`

  if (event.toolName === 'reply') {
    const payload = event.payload as { text: string; replyToMessageId?: string }
    return appendTextMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      text: payload.text,
      replyToMessageId: payload.replyToMessageId,
    })
  }

  if (event.toolName === 'send_card') {
    return appendCardMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      card: event.payload,
    })
  }

  if (event.toolName === 'send_file') {
    const payload = event.payload as { driveFileId: string; caption?: string }
    return appendMediaMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      driveFileId: payload.driveFileId,
      caption: payload.caption,
    })
  }

  if (event.toolName === 'staff_reply') {
    const payload = event.payload as { text: string; staffUserId?: string }
    return appendStaffTextMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      staffUserId: payload.staffUserId ?? `wake:${event.wakeId}`,
      body: payload.text,
    })
  }

  throw new Error(`channels/outbound: unknown toolName "${event.toolName}"`)
}

function buildOutboundMessage(event: ChannelOutboundEvent, recipient: string, persisted: Message): OutboundMessage {
  if (event.toolName === 'reply' || event.toolName === 'staff_reply') {
    const payload = event.payload as { text: string }
    return { to: recipient, text: payload.text }
  }
  if (event.toolName === 'send_card') {
    const card = event.payload as { title?: string; subtitle?: string }
    const text = [card.title, card.subtitle].filter(Boolean).join('\n') || '[card]'
    return { to: recipient, text }
  }
  if (event.toolName === 'send_file') {
    const payload = event.payload as { driveFileId: string; caption?: string }
    return { to: recipient, text: payload.caption ?? `[file:${payload.driveFileId}]` }
  }
  return { to: recipient, text: `[${event.toolName}]:${persisted.id}` }
}

export async function dispatchOutbound(event: ChannelOutboundEvent): Promise<DispatchResult> {
  // 1. Persist (one-write-path).
  const persisted = await persistMessage(event)

  // 2. Load the channel instance via the conversation's channelInstanceId.
  //    We resolve the recipient address from the contact + channel.
  const contact = await getContact(event.contactId)
  const recipient = contact.phone ?? contact.email ?? contact.id

  // 3. Look up the channel instance for this conversation and resolve adapter.
  //    The wake worker carries channelType but not channelInstanceId — we walk
  //    through the conversation row to find the bound instance.
  const conv = await getConversation(event.conversationId)
  const instance = await getInstance(conv.channelInstanceId)
  if (!instance) {
    throw new Error(`channels/outbound: instance ${conv.channelInstanceId} not found`)
  }

  const adapter = registryGet(instance.channel, instance.config, instance.id)
  if (!adapter) {
    throw new Error(`channels/outbound: no adapter registered for "${instance.channel}"`)
  }

  // 4. Send via adapter; the contract guarantees SendResult, no throw.
  const outbound = buildOutboundMessage(event, recipient, persisted)
  const send = await adapter.send(outbound)

  return { messageId: persisted.id, send }
}
