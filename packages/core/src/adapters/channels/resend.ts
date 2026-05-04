/**
 * Outbound-only email transport via Resend API.
 * Not a conversational channel — no inbound webhook support.
 * Used as a send transport for email notifications.
 */
import type { ChannelAdapter, ChannelCapabilities, OutboundMessage, SendResult } from '../../contracts/channels'

export interface ResendAdapterConfig {
  apiKey: string
  from: string
}

const EMAIL_CAPABILITIES: ChannelCapabilities = {
  templates: false,
  media: true,
  reactions: false,
  readReceipts: false,
  typingIndicators: false,
  streaming: false,
  messagingWindow: false,
  nativeThreading: true,
}

export function createResendAdapter(config: ResendAdapterConfig): ChannelAdapter {
  return {
    name: 'resend',
    inboundMode: 'pull',
    capabilities: EMAIL_CAPABILITIES,

    async send(message: OutboundMessage): Promise<SendResult> {
      const meta = (message.metadata ?? {}) as Record<string, unknown>
      const from = (meta.from as string | undefined) ?? config.from
      const cc = meta.cc as string[] | undefined
      const bcc = meta.bcc as string[] | undefined
      const replyTo = meta.replyTo as string | undefined

      const attachments = message.media
        ?.filter((m) => m.data != null)
        .map((m) => ({
          filename: m.filename ?? 'attachment',
          content: m.data?.toString('base64'),
          content_type: m.mimeType,
        }))

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            cc,
            bcc,
            reply_to: replyTo,
            ...(attachments?.length ? { attachments } : {}),
          }),
        })

        if (!response.ok) {
          const body = await response.text()
          const retryable = response.status === 429 || response.status >= 500
          return {
            success: false,
            error: `Resend API error (${response.status}): ${body}`,
            code: response.status === 429 ? 'rate_limited' : undefined,
            retryable,
          }
        }

        const data = (await response.json()) as { id?: string }
        return { success: true, messageId: data.id }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          retryable: true,
        }
      }
    },
  }
}
