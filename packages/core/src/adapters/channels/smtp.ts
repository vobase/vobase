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
 * Drives the SMTP conversation by reading each server reply (first token
 * is a 3-digit status code: 2xx/3xx proceed, 4xx transient, 5xx permanent)
 * so rejected deliveries surface as `success: false` instead of silent drops.
 */
export function createSmtpAdapter(config: SmtpAdapterConfig): ChannelAdapter {
  async function sendSmtp(message: OutboundMessage): Promise<SendResult> {
    const meta = (message.metadata ?? {}) as Record<string, unknown>
    const from = (meta.from as string | undefined) ?? config.from
    const to = [message.to]
    const cc = meta.cc as string[] | undefined
    const replyTo = meta.replyTo as string | undefined

    let socket: Awaited<ReturnType<typeof Bun.connect>> | undefined

    try {
      let pending: ((reply: string) => void) | undefined
      let buffered = ''
      let socketError: Error | undefined
      let closed = false

      const deliver = () => {
        if (!pending) return
        // A full SMTP reply ends with a line "XYZ <SP> ..." (space after code).
        // Multi-line replies use "XYZ-..." until the terminating space line.
        const lines = buffered.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (/^\d{3} /.test(line)) {
            const consumed = lines.slice(0, i + 1).join('\r\n')
            const rest = lines.slice(i + 1).join('\r\n')
            buffered = rest
            const cb = pending
            pending = undefined
            cb?.(consumed)
            return
          }
        }
      }

      socket = await Bun.connect({
        hostname: config.host,
        port: config.port,
        tls: config.secure ?? config.port === 465,
        socket: {
          data(_s, data) {
            buffered += new TextDecoder().decode(data)
            deliver()
          },
          open() {},
          close() {
            closed = true
            const cb = pending
            pending = undefined
            cb?.('')
          },
          error(_s, err) {
            socketError = err
          },
        },
      })

      const readReply = (timeoutMs = 10_000): Promise<string> =>
        new Promise((resolve, reject) => {
          if (socketError) return reject(socketError)
          if (closed) return reject(new Error('SMTP connection closed'))
          pending = resolve
          deliver()
          setTimeout(() => {
            if (pending === resolve) {
              pending = undefined
              reject(new Error('SMTP read timed out'))
            }
          }, timeoutMs).unref?.()
        })

      const expect = async (codes: number[], context: string): Promise<string> => {
        const reply = await readReply()
        const code = Number.parseInt(reply.slice(0, 3), 10)
        if (!codes.includes(code)) {
          throw new Error(`SMTP ${context} failed: ${reply.trim()}`)
        }
        return reply
      }

      const send = (cmd: string): void => {
        socket?.write(new TextEncoder().encode(`${cmd}\r\n`))
      }

      // Greeting
      await expect([220], 'greeting')

      send(`EHLO localhost`)
      await expect([250], 'EHLO')

      if (config.auth) {
        const credentials = Buffer.from(`\0${config.auth.user}\0${config.auth.pass}`).toString('base64')
        send(`AUTH PLAIN ${credentials}`)
        await expect([235], 'AUTH')
      }

      send(`MAIL FROM:<${from}>`)
      await expect([250], 'MAIL FROM')

      for (const recipient of to) {
        send(`RCPT TO:<${recipient}>`)
        await expect([250, 251], 'RCPT TO')
      }

      send('DATA')
      await expect([354], 'DATA')

      const headers = [
        `From: ${from}`,
        `To: ${to.join(', ')}`,
        `Subject: ${message.subject ?? ''}`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
      ]

      if (cc?.length) headers.push(`Cc: ${cc.join(', ')}`)
      if (replyTo) headers.push(`Reply-To: ${replyTo}`)

      if (message.html) {
        headers.push('Content-Type: text/html; charset=utf-8')
        send(`${headers.join('\r\n')}\r\n\r\n${message.html}\r\n.`)
      } else {
        headers.push('Content-Type: text/plain; charset=utf-8')
        send(`${headers.join('\r\n')}\r\n\r\n${message.text ?? ''}\r\n.`)
      }

      await expect([250], 'DATA body')

      send('QUIT')
      // Best-effort; some servers drop the connection before replying.
      await readReply(2_000).catch(() => '')

      socket.end()

      if (socketError) {
        return { success: false, error: socketError.message, retryable: true }
      }

      return { success: true }
    } catch (err) {
      socket?.end()
      const message = err instanceof Error ? err.message : String(err)
      // 4xx responses are transient per RFC 5321 §4.2.1 — callers may retry.
      const retryable = /SMTP .* failed: 4\d{2}/.test(message) || !message.includes('SMTP ')
      return { success: false, error: message, retryable }
    }
  }

  return {
    name: 'smtp',
    inboundMode: 'pull',
    capabilities: EMAIL_CAPABILITIES,
    send: sendSmtp,
  }
}
