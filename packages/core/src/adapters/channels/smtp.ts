/**
 * Outbound-only email transport via SMTP.
 * Not a conversational channel — no inbound webhook support.
 * Used as a send transport for email notifications.
 */
import type { ChannelAdapter, ChannelCapabilities, OutboundMessage, SendResult } from '../../contracts/channels'

export interface SmtpAdapterConfig {
  host: string
  port: number
  secure?: boolean
  auth?: { user: string; pass: string }
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
}

/**
 * Minimal SMTP channel adapter using Bun's TCP socket.
 * Handles basic SMTP conversation (EHLO, AUTH, MAIL FROM, RCPT TO, DATA, QUIT).
 */
export function createSmtpAdapter(config: SmtpAdapterConfig): ChannelAdapter {
  async function sendSmtp(message: OutboundMessage): Promise<SendResult> {
    const meta = (message.metadata ?? {}) as Record<string, unknown>
    const from = (meta.from as string | undefined) ?? config.from
    const to = [message.to]
    const cc = meta.cc as string[] | undefined
    const replyTo = meta.replyTo as string | undefined

    try {
      const responses: string[] = []
      let lastError: Error | undefined

      const socket = await Bun.connect({
        hostname: config.host,
        port: config.port,
        tls: config.secure ?? config.port === 465,
        socket: {
          data(_socket, data) {
            responses.push(new TextDecoder().decode(data))
          },
          open() {},
          close() {},
          error(_socket, err) {
            lastError = err
          },
        },
      })

      const send = (cmd: string) => {
        socket.write(new TextEncoder().encode(`${cmd}\r\n`))
      }

      const wait = (ms = 500) => new Promise<void>((r) => setTimeout(r, ms))

      // Wait for greeting
      await wait(300)

      send(`EHLO localhost`)
      await wait(200)

      // AUTH if configured
      if (config.auth) {
        const credentials = Buffer.from(`\0${config.auth.user}\0${config.auth.pass}`).toString('base64')
        send(`AUTH PLAIN ${credentials}`)
        await wait(200)
      }

      send(`MAIL FROM:<${from}>`)
      await wait(100)

      for (const recipient of to) {
        send(`RCPT TO:<${recipient}>`)
        await wait(100)
      }

      send('DATA')
      await wait(100)

      // Build email headers and body
      const headers = [
        `From: ${from}`,
        `To: ${to.join(', ')}`,
        `Subject: ${message.subject ?? ''}`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
      ]

      if (cc?.length) {
        headers.push(`Cc: ${cc.join(', ')}`)
      }

      if (replyTo) {
        headers.push(`Reply-To: ${replyTo}`)
      }

      if (message.html) {
        headers.push('Content-Type: text/html; charset=utf-8')
        send(`${headers.join('\r\n')}\r\n\r\n${message.html}\r\n.`)
      } else {
        headers.push('Content-Type: text/plain; charset=utf-8')
        send(`${headers.join('\r\n')}\r\n\r\n${message.text ?? ''}\r\n.`)
      }

      await wait(200)

      send('QUIT')
      await wait(100)

      socket.end()

      if (lastError) {
        return { success: false, error: lastError.message, retryable: true }
      }

      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
      }
    }
  }

  return {
    name: 'smtp',
    inboundMode: 'pull',
    capabilities: EMAIL_CAPABILITIES,
    send: sendSmtp,
  }
}
