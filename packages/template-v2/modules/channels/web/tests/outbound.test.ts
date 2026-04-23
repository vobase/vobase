/**
 * channel-web outbound handler + dispatcher integration tests.
 *
 * Verifies: payload validation, dispatcher invocation, SSE notify, transport-only discipline.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Message } from '@modules/inbox/schema'
import type { RealtimeService } from '@server/common/port-types'
import type { ChannelOutboundEvent } from '@server/contracts/channel-event'
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

mock.module('@modules/inbox/service/messages', () => ({
  appendTextMessage: async (input: unknown) => {
    calls.push({ method: 'appendTextMessage', data: input })
    return fakeMessage
  },
  appendCardMessage: async (input: unknown) => {
    calls.push({ method: 'appendCardMessage', data: input })
    return fakeMessage
  },
  appendMediaMessage: async (input: unknown) => {
    calls.push({ method: 'appendMediaMessage', data: input })
    return fakeMessage
  },
  appendStaffTextMessage: async (input: unknown) => {
    calls.push({ method: 'appendStaffTextMessage', data: input })
    return fakeMessage
  },
}))

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
  installChannelWebState(createChannelWebState({ realtime: makeRealtime() }))
})

describe('handleOutbound', () => {
  it('reply event — dispatches via appendTextMessage + notifies', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = makeEvent('reply', { text: 'Hello customer' })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown>; _status: number }

    expect(res._status).toBe(200)
    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'appendTextMessage')).toBe(true)
    expect(calls.some((c) => c.method === 'notify')).toBe(true)
  })

  it('send_card event — dispatches via appendCardMessage', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = makeEvent('send_card', { type: 'card', title: 'Invoice', children: [] })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown> }

    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'appendCardMessage')).toBe(true)
  })

  it('send_file event — dispatches via appendMediaMessage', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = makeEvent('send_file', { driveFileId: 'f-001', caption: 'See attached' })
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _body: Record<string, unknown> }

    expect(res._body.dispatched).toBe(true)
    expect(calls.some((c) => c.method === 'appendMediaMessage')).toBe(true)
  })

  it('wrong channelType is rejected with 400', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const event = { ...makeEvent('reply', { text: 'hi' }), channelType: 'whatsapp' }
    const ctx = makeCtx(event)
    const res = (await handleOutbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(400)
    expect(calls.some((c) => c.method === 'appendTextMessage')).toBe(false)
  })

  it('invalid payload schema returns 422', async () => {
    const { handleOutbound } = await import('../handlers/outbound')
    const ctx = makeCtx({ missing: 'required fields' })
    const res = (await handleOutbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(422)
  })
})
