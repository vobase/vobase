/**
 * Unit tests for the notification-mirror observer (Unit 9).
 *
 * Hand-rolled stubs around the channel adapter — we don't need a real DB or
 * vault; the observer's only side effect is calling
 * `findNotificationChannel` + the WhatsApp adapter's `send`. We swap both via
 * the channels-module install seams.
 */

import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import {
  __resetChannelInstancesServiceForTests,
  installChannelInstancesService,
} from '@modules/channels/service/instances'
import {
  __resetForTests as __resetChannelRegistryForTests,
  register as registerAdapter,
} from '@modules/channels/service/registry'
import type { ChannelAdapter, HarnessLogger, WakeRuntime } from '@vobase/core'

import { createNotificationMirrorObserver } from './notification-mirror'

// Stub runtime — the mirror observer never uses WakeRuntime; we pass it to
// satisfy the OnEventListener<WakeTrigger> signature without importing the
// full runtime machinery.
const STUB_RUNTIME = null as unknown as WakeRuntime

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const ORG = 'org-test-mirror'
const THREAD = 'thr-test-mirror'
const NOTIF_INSTANCE_ID = 'mgd-notif-org-test-mirror-staging'
const STAFF_PHONE = '+6581234567'

interface StubInstance {
  id: string
  organizationId: string
  channel: string
  role: 'customer' | 'staff'
  status: string | null
  config: Record<string, unknown>
}

const stubInstance: StubInstance = {
  id: NOTIF_INSTANCE_ID,
  organizationId: ORG,
  channel: 'whatsapp_notif',
  role: 'staff',
  status: 'active',
  config: {
    mode: 'managed-notif',
    organizationId: ORG,
    platformChannelId: 'platform-test',
    platformBaseUrl: 'http://platform.test',
    environment: 'staging',
  },
}

const sentMessages: Array<{ to: string; text?: string }> = []

function installStubChannels(): void {
  installChannelInstancesService({
    list: async (organizationId: string, channel?: string) => {
      if (organizationId !== ORG) return []
      if (channel && channel !== stubInstance.channel) return []
      // biome-ignore lint/suspicious/noExplicitAny: cross-module stub doesn't need full ChannelInstance
      return [stubInstance as any]
    },
    get: async (id: string) => (id === stubInstance.id ? (stubInstance as never) : null),
    // biome-ignore lint/suspicious/noExplicitAny: stub
    create: async () => stubInstance as any,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    update: async () => stubInstance as any,
    remove: async () => undefined,
    hardRemove: async () => undefined,
  })
}

function installStubAdapter(): void {
  const stubAdapter: ChannelAdapter = {
    name: 'whatsapp_notif',
    inboundMode: 'push',
    capabilities: {
      templates: false,
      media: false,
      reactions: false,
      readReceipts: false,
      typingIndicators: false,
      streaming: false,
      messagingWindow: false,
      nativeThreading: false,
    },
    send: async (msg) => {
      sentMessages.push({ to: msg.to, text: msg.text })
      return { success: true, messageId: 'stub-msg-id' }
    },
  }
  registerAdapter('whatsapp_notif', () => stubAdapter, stubAdapter.capabilities)
}

beforeAll(() => {
  installStubChannels()
  installStubAdapter()
})

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
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: null,
      notificationChannelInstanceId: NOTIF_INSTANCE_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'hi') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops when notificationChannelInstanceId is null', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      notificationChannelInstanceId: null,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'hi') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops on non-message_end events', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      notificationChannelInstanceId: NOTIF_INSTANCE_ID,
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
      staffPhoneE164: STAFF_PHONE,
      notificationChannelInstanceId: NOTIF_INSTANCE_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('tool', 'tool output') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('no-ops on empty assistant content', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      notificationChannelInstanceId: NOTIF_INSTANCE_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', '   ') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(0)
  })

  it('sends to the staff phone on assistant message_end with content', async () => {
    const observer = createNotificationMirrorObserver({
      organizationId: ORG,
      threadId: THREAD,
      staffPhoneE164: STAFF_PHONE,
      notificationChannelInstanceId: NOTIF_INSTANCE_ID,
      logger: NOOP_LOGGER,
    })
    await observer(makeMessageEnd('assistant', 'Hello from agent') as never, STUB_RUNTIME)
    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]).toEqual({ to: STAFF_PHONE, text: 'Hello from agent' })
  })
})

// Reset registry/services AFTER all tests in this file so we don't leak into
// other test files. Note: bun:test runs files sequentially per process so the
// install-then-reset cycle is safe within a process.
afterEach(() => {
  // no-op per-test cleanup; only sentMessages reset above
})

// Final cleanup at module teardown — bun:test exposes via afterAll
import { afterAll } from 'bun:test'

afterAll(() => {
  __resetChannelInstancesServiceForTests()
  __resetChannelRegistryForTests()
})
