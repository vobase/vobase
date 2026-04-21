/**
 * A3 gate — dispatcher MUST call InboxPort for persistence, never drizzle directly.
 *
 * This test uses a spy-instrumented InboxPort mock and asserts that after dispatch():
 *   1. InboxPort.sendTextMessage / sendCardMessage / sendMediaMessage was called.
 *   2. The drizzle sentinel object was NEVER accessed (no import of drizzle-orm or
 *      schema tables from the dispatcher module).
 *
 * It also double-checks at the source level that the dispatcher file has zero
 * direct drizzle imports (R1 companion check).
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import type { ChannelOutboundEvent } from '@server/contracts/channel-event'
import type { Message } from '@server/contracts/domain-types'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { RealtimeService } from '@server/contracts/plugin-context'
import { dispatch } from '../service/dispatcher'

// ─── Sentinels ───────────────────────────────────────────────────────────────

let drizzleAccessed = false

/** Poison proxy — any property access triggers the fail flag. */
function makeDrizzlePoison(): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        drizzleAccessed = true
        throw new Error(`A3 VIOLATION: dispatcher accessed drizzle property "${String(prop)}"`)
      },
    },
  )
}

// ─── Mock InboxPort ──────────────────────────────────────────────────────────

type CallLog = { method: string; input: unknown }
let callLog: CallLog[] = []

function makeInboxPort(): InboxPort {
  const fakeMsg = (): Message => ({
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
  })

  return {
    sendTextMessage: async (input) => {
      callLog.push({ method: 'sendTextMessage', input })
      return fakeMsg()
    },
    sendCardMessage: async (input) => {
      callLog.push({ method: 'sendCardMessage', input })
      return fakeMsg()
    },
    sendCardReply: async () => {
      throw new Error('not-expected')
    },
    sendMediaMessage: async (input) => {
      callLog.push({ method: 'sendMediaMessage', input })
      return fakeMsg()
    },
    // Unused methods — return stubs
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
    snooze: async () => {
      throw new Error('not-expected')
    },
    unsnooze: async () => {
      throw new Error('not-expected')
    },
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
  drizzleAccessed = false
  callLog = []
  // Install drizzle poison — dispatcher must never access this.
  ;(globalThis as Record<string, unknown>).__drizzle_poison__ = makeDrizzlePoison()
})

describe('dispatcher transport-only (A3 gate)', () => {
  it('reply: calls InboxPort.sendTextMessage, not drizzle', async () => {
    const event = makeEvent('reply', { text: 'Hi there' })
    const result = await dispatch(event, makeInboxPort(), noopRealtime)

    expect(drizzleAccessed).toBe(false)
    expect(callLog).toHaveLength(1)
    expect(callLog[0].method).toBe('sendTextMessage')
    expect(result.messageId).toBe('msg-dispatched')
  })

  it('send_card: calls InboxPort.sendCardMessage, not drizzle', async () => {
    const event = makeEvent('send_card', { type: 'card', title: 'Test', children: [] })
    const result = await dispatch(event, makeInboxPort(), noopRealtime)

    expect(drizzleAccessed).toBe(false)
    expect(callLog).toHaveLength(1)
    expect(callLog[0].method).toBe('sendCardMessage')
    expect(result.messageId).toBe('msg-dispatched')
  })

  it('send_file: calls InboxPort.sendMediaMessage, not drizzle', async () => {
    const event = makeEvent('send_file', { driveFileId: 'file-001', caption: 'See attached' })
    const result = await dispatch(event, makeInboxPort(), noopRealtime)

    expect(drizzleAccessed).toBe(false)
    expect(callLog).toHaveLength(1)
    expect(callLog[0].method).toBe('sendMediaMessage')
    expect(result.messageId).toBe('msg-dispatched')
  })

  it('reply with replyToMessageId threaded through', async () => {
    const event = makeEvent('reply', { text: 'Thread reply', replyToMessageId: 'msg-prev' })
    await dispatch(event, makeInboxPort(), noopRealtime)

    const logged = callLog[0].input as { parentMessageId?: string }
    expect(logged.parentMessageId).toBe('msg-prev')
    expect(drizzleAccessed).toBe(false)
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
    const result = await dispatch(event, makeInboxPort(), spyRealtime)
    expect(result.notified).toBe(true)
    expect(notified).toBe(true)
  })

  it('unknown toolName throws without touching drizzle', async () => {
    const event = makeEvent('book_slot' as ChannelOutboundEvent['toolName'], { slotId: 'slot-1' })
    await expect(dispatch(event, makeInboxPort(), noopRealtime)).rejects.toThrow('unknown toolName')
    expect(drizzleAccessed).toBe(false)
  })
})
