/**
 * Simulated channel-web inbound — fires POST requests via Hono app.request() so
 * tests exercise the real handler code without a running HTTP server.
 *
 * Installs the channel-web state factory and captures enqueued jobs via an in-memory spy.
 */
import { createHmac } from 'node:crypto'
import { handleInbound } from '@modules/channels/web/handlers/inbound'
import { createChannelWebState, installChannelWebState } from '@modules/channels/web/service/state'
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { InboxPort } from '@server/contracts/inbox-port'
import { Hono } from 'hono'

export interface CapturedJob {
  name: string
  data: unknown
}

export interface InboundRequest {
  organizationId: string
  /** Session token — used as `from` for contact resolution. */
  from: string
  text: string
  externalMessageId?: string
  profileName?: string
}

export interface InboundResponse {
  conversationId: string
  messageId: string
  deduplicated: boolean
}

export interface SimulatedChannelWeb {
  postInbound(req: InboundRequest): Promise<InboundResponse>
  capturedJobs: CapturedJob[]
  readonly channelInstanceId: string
  readonly secret: string
}

export interface SimulatedChannelWebOpts {
  inboxPort: InboxPort
  contactsPort: ContactsPort
  channelInstanceId?: string
  secret?: string
}

let msgCounter = 0

export function createSimulatedChannelWeb(opts: SimulatedChannelWebOpts): SimulatedChannelWeb {
  const secret = opts.secret ?? 'test-secret'
  const channelInstanceId = opts.channelInstanceId ?? 'chi0cust00'
  const capturedJobs: CapturedJob[] = []

  installChannelWebState(
    createChannelWebState({
      inbox: opts.inboxPort,
      contacts: opts.contactsPort,
      jobs: {
        async send(name: string, data: unknown): Promise<string> {
          capturedJobs.push({ name, data })
          return `fake-job-${Date.now()}`
        },
      },
    }),
  )

  const app = new Hono()
  app.post('/api/channel-web/inbound', handleInbound)

  return {
    capturedJobs,
    channelInstanceId,
    secret,

    async postInbound({
      organizationId,
      from,
      text,
      externalMessageId,
      profileName,
    }: InboundRequest): Promise<InboundResponse> {
      msgCounter += 1
      const msgId = externalMessageId ?? `ext-msg-${Date.now()}-${msgCounter}`
      const payload = {
        organizationId,
        channelType: 'web',
        from,
        externalMessageId: msgId,
        content: text,
        contentType: 'text',
        profileName: profileName ?? from,
        timestamp: Date.now(),
      }
      const body = JSON.stringify(payload)
      const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

      const res = await app.request('/api/channel-web/inbound', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': sig,
          'x-channel-secret': secret,
          'x-channel-instance-id': channelInstanceId,
        },
        body,
      })

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`simulated-channel-web: POST failed ${res.status}: ${errBody}`)
      }

      const json = (await res.json()) as InboundResponse
      return json
    },
  }
}
