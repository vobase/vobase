/** Outbound dispatcher — transport only. Persistence flows through messaging service. */
import {
  appendCardMessage,
  appendMediaMessage,
  appendStaffTextMessage,
  appendTextMessage,
} from '@modules/messaging/service/messages'
import type { RealtimeService } from '@server/common/port-types'
import type { ChannelOutboundEvent } from '@server/contracts/channel-event'
import { nanoid } from 'nanoid'

export interface DispatchResult {
  messageId: string
  notified: boolean
}

function toolCtx(wakeId: string) {
  return {
    wakeId,
    toolCallId: `wake-${nanoid(8)}`,
    turnIndex: 0,
  }
}

export async function dispatch(event: ChannelOutboundEvent, realtime: RealtimeService): Promise<DispatchResult> {
  const ctx = toolCtx(event.wakeId)
  const agentId = `wake:${event.wakeId}`
  let messageId: string

  if (event.toolName === 'reply') {
    const payload = event.payload as { text: string; replyToMessageId?: string }
    const msg = await appendTextMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      text: payload.text,
      replyToMessageId: payload.replyToMessageId,
    })
    messageId = msg.id
  } else if (event.toolName === 'send_card') {
    const msg = await appendCardMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      card: event.payload,
    })
    messageId = msg.id
  } else if (event.toolName === 'send_file') {
    const payload = event.payload as { driveFileId: string; caption?: string }
    const msg = await appendMediaMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      driveFileId: payload.driveFileId,
      caption: payload.caption,
    })
    messageId = msg.id
  } else if (event.toolName === 'staff_reply') {
    const payload = event.payload as { text: string; staffUserId?: string }
    const msg = await appendStaffTextMessage({
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      staffUserId: payload.staffUserId ?? `wake:${event.wakeId}`,
      body: payload.text,
    })
    messageId = msg.id
  } else {
    throw new Error(`channel-web/dispatcher: unknown toolName "${event.toolName}"`)
  }

  realtime.notify({ table: 'messages', id: messageId, action: 'INSERT' })

  return { messageId, notified: true }
}
