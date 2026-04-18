/** Outbound dispatcher — transport only. Persistence flows through InboxPort. */
import type { ChannelOutboundEvent } from '@server/contracts/channel-event'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { RealtimeService } from '@server/contracts/plugin-context'

export interface DispatchResult {
  messageId: string
  notified: boolean
}

function agentAuthor(wakeId: string) {
  return { kind: 'agent' as const, id: `wake:${wakeId}` }
}

export async function dispatch(
  event: ChannelOutboundEvent,
  inboxPort: InboxPort,
  realtime: RealtimeService,
): Promise<DispatchResult> {
  const author = agentAuthor(event.wakeId)

  let messageId: string

  if (event.toolName === 'reply') {
    const payload = event.payload as { text: string; replyToMessageId?: string }
    const msg = await inboxPort.sendTextMessage({
      conversationId: event.conversationId,
      tenantId: event.tenantId,
      author,
      body: payload.text,
      parentMessageId: payload.replyToMessageId,
      wakeId: event.wakeId,
    })
    messageId = msg.id
  } else if (event.toolName === 'send_card') {
    const msg = await inboxPort.sendCardMessage({
      conversationId: event.conversationId,
      tenantId: event.tenantId,
      author,
      card: event.payload,
      wakeId: event.wakeId,
    })
    messageId = msg.id
  } else if (event.toolName === 'send_file') {
    const payload = event.payload as { driveFileId: string; caption?: string }
    const msg = await inboxPort.sendMediaMessage({
      conversationId: event.conversationId,
      tenantId: event.tenantId,
      author,
      driveFileId: payload.driveFileId,
      caption: payload.caption,
      wakeId: event.wakeId,
    })
    messageId = msg.id
  } else {
    throw new Error(`channel-web/dispatcher: unknown toolName "${event.toolName}"`)
  }

  realtime.notify({ table: 'messages', id: messageId, action: 'INSERT' })

  return { messageId, notified: true }
}
