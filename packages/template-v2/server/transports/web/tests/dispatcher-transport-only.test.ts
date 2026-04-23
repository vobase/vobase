/**
 * A3 gate — dispatcher MUST delegate persistence to the messaging service,
 * never touch drizzle (or schema) directly.
 *
 * Two-layer check:
 *   1. Source-level: dispatcher.ts has no `drizzle-orm` or schema imports.
 *   2. Runtime: installed messaging service stub records every call and asserts
 *      dispatcher routes the right tool name to the right service function.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Message } from '@modules/messaging/schema'
import {
  __resetMessagesServiceForTests,
  installMessagesService,
  type MessagesService,
} from '@modules/messaging/service/messages'
import type { RealtimeService } from '@server/common/port-types'
import type { ChannelOutboundEvent } from '@server/transports/events'
import { dispatch } from '../service/dispatcher'

type CallLog = { method: string; input: unknown }
let callLog: CallLog[] = []

const fakeMsg = (): Message =>
  ({
    id: 'msg-dispatched',
    conversationId: 'conv-1',
    organizationId: 'org-1',
    role: 'agent',
    kind: 'text',
    content: {},
    parentMessageId: null,
    channelExternalId: null,
    status: null,
    createdAt: new Date(),
  }) as unknown as Message

function makeMessagesServiceStub(): MessagesService {
  const notImplemented = async () => {
    throw new Error('dispatcher-transport-only.test: messages-service method not stubbed')
  }
  return {
    appendTextMessage: async (input) => {
      callLog.push({ method: 'appendTextMessage', input })
      return fakeMsg()
    },
    appendCardMessage: async (input) => {
      callLog.push({ method: 'appendCardMessage', input })
      return fakeMsg()
    },
    appendMediaMessage: async (input) => {
      callLog.push({ method: 'appendMediaMessage', input })
      return fakeMsg()
    },
    appendStaffTextMessage: async (input) => {
      callLog.push({ method: 'appendStaffTextMessage', input })
      return fakeMsg()
    },
    appendCardReplyMessage: notImplemented as MessagesService['appendCardReplyMessage'],
    list: notImplemented as MessagesService['list'],
  }
}

const noopRealtime: RealtimeService = { notify: () => {}, subscribe: () => () => {} }

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

beforeEach(() => {
  callLog = []
  __resetMessagesServiceForTests()
  installMessagesService(makeMessagesServiceStub())
})

describe('dispatcher transport-only (A3 gate)', () => {
  it('dispatcher source has no drizzle or schema imports', async () => {
    const path = fileURLToPath(new URL('../service/dispatcher.ts', import.meta.url))
    const src = await readFile(path, 'utf8')
    expect(src).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(src).not.toMatch(/from\s+['"]@modules\/[^'"]+\/schema['"]/)
  })

  it('reply: calls appendTextMessage', async () => {
    const event = makeEvent('reply', { text: 'Hi there' })
    const result = await dispatch(event, noopRealtime)
    expect(callLog).toHaveLength(1)
    expect(callLog[0].method).toBe('appendTextMessage')
    expect(result.messageId).toBe('msg-dispatched')
  })

  it('send_card: calls appendCardMessage', async () => {
    const event = makeEvent('send_card', { type: 'card', title: 'Test', children: [] })
    const result = await dispatch(event, noopRealtime)
    expect(callLog).toHaveLength(1)
    expect(callLog[0].method).toBe('appendCardMessage')
    expect(result.messageId).toBe('msg-dispatched')
  })

  it('send_file: calls appendMediaMessage', async () => {
    const event = makeEvent('send_file', { driveFileId: 'file-001', caption: 'See attached' })
    const result = await dispatch(event, noopRealtime)
    expect(callLog).toHaveLength(1)
    expect(callLog[0].method).toBe('appendMediaMessage')
    expect(result.messageId).toBe('msg-dispatched')
  })

  it('reply with replyToMessageId threaded through', async () => {
    const event = makeEvent('reply', { text: 'Thread reply', replyToMessageId: 'msg-prev' })
    await dispatch(event, noopRealtime)
    const logged = callLog[0].input as { replyToMessageId?: string }
    expect(logged.replyToMessageId).toBe('msg-prev')
  })

  it('notified flag is true after dispatch', async () => {
    let notified = false
    const spyRealtime: RealtimeService = {
      notify: () => {
        notified = true
      },
      subscribe: () => () => {},
    }
    const event = makeEvent('reply', { text: 'ping' })
    const result = await dispatch(event, spyRealtime)
    expect(result.notified).toBe(true)
    expect(notified).toBe(true)
  })

  it('unknown toolName throws', async () => {
    const event = makeEvent('book_slot' as ChannelOutboundEvent['toolName'], { slotId: 'slot-1' })
    await expect(dispatch(event, noopRealtime)).rejects.toThrow('unknown toolName')
  })
})
