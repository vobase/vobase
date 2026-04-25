/**
 * channel-web outbound handler + dispatcher integration tests.
 *
 * Verifies: payload validation, dispatcher invocation, SSE notify, transport-only discipline.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import type { ChannelOutboundEvent } from '@modules/messaging/channel-events'
import type { Message } from '@modules/messaging/schema'
import {
  __resetMessagesServiceForTests,
  installMessagesService,
  type MessagesService,
} from '@modules/messaging/service/messages'

import type { RealtimeService } from '~/runtime'
import { handleOutbound } from '../handlers/outbound'
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

function makeMessagesServiceStub(): MessagesService {
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  const notImplemented = async () => {
    throw new Error('outbound.test: messages-service method not stubbed')
  }
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    appendTextMessage: async (input) => {
      calls.push({ method: 'appendTextMessage', data: input })
      return fakeMessage
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    appendCardMessage: async (input) => {
      calls.push({ method: 'appendCardMessage', data: input })
      return fakeMessage
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    appendMediaMessage: async (input) => {
      calls.push({ method: 'appendMediaMessage', data: input })
      return fakeMessage
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    appendStaffTextMessage: async (input) => {
      calls.push({ method: 'appendStaffTextMessage', data: input })
      return fakeMessage
    },
    appendCardReplyMessage: notImplemented as MessagesService['appendCardReplyMessage'],
    list: notImplemented as MessagesService['list'],
  }
}

function makeRealtime(): RealtimeService {
  return {
    notify: (payload) => {
      calls.push({ method: 'notify', data: payload })
    },
    subscribe: () => () => {},
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
  __resetMessagesServiceForTests()
  installMessagesService(makeMessagesServiceStub())
  installChannelWebState(createChannelWebState({ realtime: makeRealtime() }))
})

describe('handleOutbound', () => {
  it('reply event — dispatches via appendTextMessage + notifies', async () => {
    const event = makeEvent('reply', { text: 'Hello customer' })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown>; _status: number }

    expect(res._status).toBe(200)
    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'appendTextMessage')).toBe(true)
    expect(calls.some((c) => c.method === 'notify')).toBe(true)
  })

  it('send_card event — dispatches via appendCardMessage', async () => {
    const event = makeEvent('send_card', { type: 'card', title: 'Invoice', children: [] })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown> }

    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'appendCardMessage')).toBe(true)
  })

  it('send_file event — dispatches via appendMediaMessage', async () => {
    const event = makeEvent('send_file', { driveFileId: 'f-001', caption: 'See attached' })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown> }

    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'appendMediaMessage')).toBe(true)
  })

  it('wrong channelType is rejected with 400', async () => {
    const event = { ...makeEvent('reply', { text: 'hi' }), channelType: 'whatsapp' }
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(400)
    expect(calls.some((c) => c.method === 'appendTextMessage')).toBe(false)
  })

  it('invalid payload schema returns 422', async () => {
    const ctx = makeCtx({ missing: 'required fields' })
    const res = (await handleOutbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(422)
  })
})
