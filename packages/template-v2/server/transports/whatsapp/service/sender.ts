/** WhatsApp outbound sender — transport only; persistence flows through MessagingPort. */
import type { ChannelOutboundEvent } from '@server/contracts/channel-event'
import type { SendResult } from '@vobase/core'

const META_API_VERSION = 'v20.0'
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

export interface WaSenderConfig {
  phoneNumberId: string
  accessToken: string
}

async function metaPost(config: WaSenderConfig, path: string, body: unknown): Promise<{ messageId?: string }> {
  const url = `${META_BASE_URL}/${config.phoneNumberId}/${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`channel-whatsapp/sender: Meta API error ${res.status}: ${text}`)
  }
  const json = (await res.json()) as { messages?: Array<{ id: string }> }
  return { messageId: json.messages?.[0]?.id }
}

/**
 * Send a ChannelOutboundEvent via the Meta Cloud API.
 * Caller must pass the recipient's WA phone number (resolved from contact).
 */
export async function sendOutbound(
  event: ChannelOutboundEvent,
  recipientPhone: string,
  config: WaSenderConfig,
): Promise<SendResult> {
  if (event.toolName === 'reply') {
    const payload = event.payload as { text: string }
    const res = await metaPost(config, 'messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: { body: payload.text, preview_url: false },
    })
    return { success: true, messageId: res.messageId }
  }

  if (event.toolName === 'send_card') {
    const card = event.payload as { title?: string; subtitle?: string; children?: unknown[] }
    const body = [card.title, card.subtitle].filter(Boolean).join('\n')
    const res = await metaPost(config, 'messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: { body: body || '[card]' },
    })
    return { success: true, messageId: res.messageId }
  }

  if (event.toolName === 'send_file') {
    const payload = event.payload as { driveFileId: string; caption?: string }
    // Phase 2: send as document link (full signed URL upload lands in Phase 3).
    const res = await metaPost(config, 'messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: { body: payload.caption ?? `[file:${payload.driveFileId}]` },
    })
    return { success: true, messageId: res.messageId }
  }

  if (event.toolName === 'staff_reply') {
    const payload = event.payload as { text: string }
    const res = await metaPost(config, 'messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: { body: payload.text, preview_url: false },
    })
    return { success: true, messageId: res.messageId }
  }

  return { success: false, error: `unknown toolName "${event.toolName}"` }
}
