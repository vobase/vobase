/**
 * Unit tests for the notification-mirror observer.
 *
 * The observer's only side effect is calling `sendNotificationText`. We
 * stub that module so no DB / platform fetch is needed; the assertions
 * verify the (to, text) the observer dispatches under each trigger shape.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { HarnessLogger, WakeRuntime } from '@vobase/core'

import type { ScopedDb } from '~/runtime'

interface SentMsg {
  orgId: string
  to: string
  text: string
}
const sentMessages: SentMsg[] = []

mock.module('@modules/channels/service/notification-send', () => ({
  sendNotificationText: async (_db: unknown, orgId: string, input: { to: string; text: string }) => {
    sentMessages.push({ orgId, to: input.to, text: input.text })
    return { success: true, messageId: 'stub-msg-id', wireRoute: 'freeform' as const }
  },
}))

import { createNotificationMirrorObserver } from './notification-mirror'

// Stub runtime — the mirror observer never uses WakeRuntime; we pass it to
// satisfy the OnEventListener<WakeTrigger> signature.
const STUB_RUNTIME = null as unknown as WakeRuntime

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const ORG = 'org-test-mirror'
const THREAD = 'thr-test-mirror'
const STAFF_PHONE = '+6581234567'
const STUB_DB = {} as ScopedDb

afterEach(() => {
  sentMessages.length = 0
})

function makeMessageEnd(
  role: 'assistant' | 'tool' | 'user' | 'system',
  content: string,
): {
  type: 'message_end'
  role: string
  content: string
  messageId: string
  ts: Date
  wakeId: string
  conversationId: string
  organizationId: string
  turnIndex: number
} {
  return {
    type: 'message_end',
    role,
    content,
    messageId: 'msg-1',
    ts: new Date(),
    wakeId: 'wake-1',
    conversationId: 'conv-test',
    organizationId: ORG,
    turnIndex: 0,
  }
}

describe('createNotificationMirrorObserver', () => {
  it('no-ops when staffPhoneE164 is null', async () => {
    const observer = createNotificationMirrorObserver({
      db: STUB_DB,
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: null,
      hasNotificationSettings: true,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'hi') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops when hasNotificationSettings is false', async () => {
    const observer = createNotificationMirrorObserver({
      db: STUB_DB,
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      hasNotificationSettings: false,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'hi') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops on non-message_end events', async () => {
    const observer = createNotificationMirrorObserver({
      db: STUB_DB,
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      hasNotificationSettings: true,
      logger: NOOP_LOGGER,
    })
    await observer(
      {
        type: 'turn_start',
        ts: new Date(),
        wakeId: 'wake-1',
        conversationId: 'conv-1',
        organizationId: ORG,
        turnIndex: 0,
      } as never,
      STUB_RUNTIME,
    )
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops on tool message_end (only assistant role mirrored)', async () => {
    const observer = createNotificationMirrorObserver({
      db: STUB_DB,
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      hasNotificationSettings: true,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('tool', 'tool output') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops on empty assistant content', async () => {
    const observer = createNotificationMirrorObserver({
      db: STUB_DB,
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      hasNotificationSettings: true,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', '   ') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('calls sendNotificationText with (staffPhone, assistant text) on a real message_end', async () => {
    const observer = createNotificationMirrorObserver({
      db: STUB_DB,
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      hasNotificationSettings: true,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'Hello from agent') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]).toEqual({ orgId: ORG, to: STAFF_PHONE, text: 'Hello from agent' })
  })
})
