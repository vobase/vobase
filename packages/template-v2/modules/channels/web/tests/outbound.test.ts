/**
 * channel-web outbound handler + dispatcher integration tests.
 *
 * Verifies: payload validation, dispatcher invocation, SSE notify, transport-only discipline.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import type { ChannelOutboundEvent } from '@server/contracts/channel-event'
import type { Conversation, Message } from '@server/contracts/domain-types'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { RealtimeService } from '@server/contracts/plugin-context'
import { createChannelWebState, installChannelWebState } from '../service/state'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type CallRecord = { method: string; data: unknown }
let calls: CallRecord[] = []

const fakeMessage: Message = {
  id: 'msg-outbound-1',
  conversationId: 'conv-1',
  organizationId: 'org-1',
  role: 'agent',
  kind: 'text',
  content: { text: 'hello' },
  parentMessageId: null,
  channelExternalId: null,
  status: null,
  createdAt: new Date(),
}

function makeInboxPort(): InboxPort {
  return {
    sendTextMessage: async (input) => {
      calls.push({ method: 'sendTextMessage', data: input })
      return fakeMessage
    },
    sendCardMessage: async (input) => {
      calls.push({ method: 'sendCardMessage', data: input })
      return fakeMessage
    },
    sendMediaMessage: async (input) => {
      calls.push({ method: 'sendMediaMessage', data: input })
      return fakeMessage
    },
    sendCardReply: async () => {
      throw new Error('not-expected')
    },
    getConversation: async () => {
      throw new Error('not-expected')
    },
    listMessages: async () => [],
    createConversation: async () => {
      throw new Error('not-expected')
    },
    sendImageMessage: async () => {
      throw new Error('not-expected')
    },
    resolve: async () => {},
    reassign: async () => {},
    reopen: async () => {},
    reset: async () => {},
    snooze: async () => ({}) as Conversation,
    unsnooze: async () => ({}) as Conversation,
    addInternalNote: async () => {
      throw new Error('not-expected')
    },
    listInternalNotes: async () => [],
    insertPendingApproval: async () => {
      throw new Error('not-expected')
    },
    createInboundMessage: async () => {
      throw new Error('not-expected')
    },
  }
}

function makeRealtime(): RealtimeService {
  return {
    notify: (payload) => {
      calls.push({ method: 'notify', data: payload })
    },
  }
}

function makeEvent(toolName: ChannelOutboundEvent['toolName'], payload: unknown): ChannelOutboundEvent {
  return {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    wakeId: 'wake-1',
    channelType: 'web',
    toolName,
    payload,
  }
}

function makeCtx(body: unknown) {
  return {
    req: {
      json: async () => body,
      text: async () => JSON.stringify(body),
      header: () => undefined,
    },
    json: (data: unknown, status = 200) => ({ _body: data, _status: status }),
    text: (t: string, s = 200) => ({ _body: t, _status: s }),
  } as unknown as import('hono').Context
}

beforeEach(() => {
  calls = []
  installChannelWebState(
    createChannelWebState({
      inbox: makeInboxPort(),
      realtime: makeRealtime(),
    }),
  )
})

describe('handleOutbound', () => {
  it('reply event — dispatches via InboxPort.sendTextMessage + notifies', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = makeEvent('reply', { text: 'Hello customer' })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown>; _status: number }

    expect(res._status).toBe(200)
    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'sendTextMessage')).toBe(true)
    expect(calls.some((c) => c.method === 'notify')).toBe(true)
  })

  it('send_card event — dispatches via InboxPort.sendCardMessage', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = makeEvent('send_card', { type: 'card', title: 'Invoice', children: [] })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown> }

    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'sendCardMessage')).toBe(true)
  })

  it('send_file event — dispatches via InboxPort.sendMediaMessage', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = makeEvent('send_file', { driveFileId: 'f-001', caption: 'See attached' })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown> }

    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'sendMediaMessage')).toBe(true)
  })

  it('wrong channelType is rejected with 400', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = { ...makeEvent('reply', { text: 'hi' }), channelType: 'whatsapp' }
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(400)
    expect(calls.some((c) => c.method === 'sendTextMessage')).toBe(false)
  })

  it('invalid payload schema returns 422', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const ctx = makeCtx({ missing: 'required fields' })
    const res = (await handleOutbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(422)
  })
})
