/**
 * Unit tests for the notification-mirror observer.
 *
 * The observer resolves the org's notification channel via
 * `findNotificationChannel`, builds an adapter via the channels registry,
 * and calls `adapter.send`. We use the real install seams — a stub
 * channel-instances service + a stub adapter registered under
 * `whatsapp_notif` — so no DB / platform fetch is needed and no global
 * `mock.module` leaks into sibling test files.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import type { ChannelInstance } from '@modules/channels/schema'
import {
  __resetChannelInstancesServiceForTests,
  installChannelInstancesService,
} from '@modules/channels/service/instances'
import {
  register as registerAdapter,
  __resetForTests as resetChannelRegistry,
} from '@modules/channels/service/registry'
import type { ChannelAdapter, HarnessLogger, WakeRuntime } from '@vobase/core'

import type { ScopedDb } from '~/runtime'
import { createNotificationMirrorObserver } from './notification-mirror'

const ORG = 'org-test-mirror'
const THREAD = 'thr-test-mirror'
const STAFF_USER = 'usr-test-mirror'
const STAFF_PHONE = '+6581234567'
const NOTIF_CHANNEL_ID = `mgd-${ORG}-staging-notif`

/**
 * Stub `ScopedDb` for the observer's per-dispatch phone lookup
 * (`select().from(staffProfiles).innerJoin(authUser).where().limit()`).
 * Returns the given phone, or an empty result when `phone` is null (the
 * staff member is no longer a verified member of the org).
 */
function makeStubDb(phone: string | null): ScopedDb {
  const result = phone ? [{ phone }] : []
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
  }
  return chain as unknown as ScopedDb
}

interface SentMsg {
  to: string
  text: string
}
const sentMessages: SentMsg[] = []

function makeChannel(): ChannelInstance {
  return {
    id: NOTIF_CHANNEL_ID,
    organizationId: ORG,
    channel: 'whatsapp_notif',
    role: 'staff',
    displayName: 'Staff WhatsApp notification',
    config: { mode: 'managed', kind: 'notification' },
    platformChannelId: 'pc-notif-mirror',
    webhookSecret: null,
    status: 'active',
    setupStage: 'active',
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const STUB_ADAPTER: ChannelAdapter = {
  // biome-ignore lint/suspicious/noExplicitAny: stub adapter — only `send` is exercised
  capabilities: {} as any,
  send: async (input: { to: string; text: string }) => {
    sentMessages.push({ to: input.to, text: input.text })
    return { success: true, messageId: 'stub-msg-id' }
  },
  // biome-ignore lint/suspicious/noExplicitAny: stub adapter — unused surface
} as any

beforeAll(() => {
  installChannelInstancesService({
    list: async (organizationId: string, channel?: string) => {
      if (organizationId !== ORG) return []
      if (channel && channel !== 'whatsapp_notif') return []
      return [makeChannel()]
    },
    get: async () => null,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    create: async () => null as any,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    update: async () => null as any,
    remove: async () => undefined,
    hardRemove: async () => undefined,
  })
  registerAdapter('whatsapp_notif', () => STUB_ADAPTER, STUB_ADAPTER.capabilities)
})

afterAll(() => {
  __resetChannelInstancesServiceForTests()
  resetChannelRegistry()
})

// Stub runtime — the mirror observer never uses WakeRuntime; we pass it to
// satisfy the OnEventListener<WakeTrigger> signature.
const STUB_RUNTIME = null as unknown as WakeRuntime

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

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
  it('no-ops when staffUserId is null', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      db: makeStubDb(STAFF_PHONE),
      staffUserId: null,
      notificationChannelInstanceId: NOTIF_CHANNEL_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'hi') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops when notificationChannelInstanceId is null', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      db: makeStubDb(STAFF_PHONE),
      staffUserId: STAFF_USER,
      notificationChannelInstanceId: null,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'hi') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops when the staff member is no longer a verified org member', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      db: makeStubDb(null),
      staffUserId: STAFF_USER,
      notificationChannelInstanceId: NOTIF_CHANNEL_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'hi') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops on non-message_end events', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      db: makeStubDb(STAFF_PHONE),
      staffUserId: STAFF_USER,
      notificationChannelInstanceId: NOTIF_CHANNEL_ID,
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
      organizationId: ORG,
      threadId: THREAD,
      db: makeStubDb(STAFF_PHONE),
      staffUserId: STAFF_USER,
      notificationChannelInstanceId: NOTIF_CHANNEL_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('tool', 'tool output') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops on empty assistant content', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      db: makeStubDb(STAFF_PHONE),
      staffUserId: STAFF_USER,
      notificationChannelInstanceId: NOTIF_CHANNEL_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', '   ') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('sends (staffPhone, assistant text) via the channel adapter on a real message_end', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      db: makeStubDb(STAFF_PHONE),
      staffUserId: STAFF_USER,
      notificationChannelInstanceId: NOTIF_CHANNEL_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'Hello from agent') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]).toEqual({ to: STAFF_PHONE, text: '[Agent]: Hello from agent' })
  })
})
