/**
 * Unit tests for the mention-notify rewrite (Unit 8).
 *
 * Covers the WHERE/WHO contract:
 *   - sends through `findNotificationChannel` (NOT the customer-WA channel)
 *   - dials `staff_profiles.whatsappPhoneE164` (NOT `staff_channel_bindings`)
 *   - records a `pendingMentionPings` row ONLY on a successful WA send AND
 *     when an agent authored the note
 *
 * The integration with `addNote` post-commit fan-out is covered by
 * `tests/e2e/supervisor-mention-fanout.test.ts` already; this file isolates
 * the mention-notify side effects via stubs.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import {
  __resetChannelInstancesServiceForTests,
  installChannelInstancesService,
} from '@modules/channels/service/instances'
import {
  __resetForTests as __resetChannelRegistryForTests,
  register as registerAdapter,
} from '@modules/channels/service/registry'
import {
  __resetNotificationPrefsServiceForTests,
  installNotificationPrefsService,
} from '@modules/settings/service/notification-prefs'
import type { ChannelAdapter, HarnessLogger } from '@vobase/core'

import {
  __resetMentionNotifyServiceForTests,
  createMentionNotifyService,
  fanOutNoteMentions,
  installMentionNotifyService,
} from './mention-notify'
import {
  __resetPendingMentionPingServiceForTests,
  installPendingMentionPingService,
  type PendingMentionPingService,
} from './pending-mention-pings'
import { __resetStaffServiceForTests, installStaffService } from './staff'

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
void NOOP_LOGGER

const ORG = 'org-test-mn'
const STAFF_X = 'usr-test-mn-x'
const STAFF_NO_PHONE = 'usr-test-mn-y'
const STAFF_ONLINE = 'usr-test-mn-z'
const NOTIF_INSTANCE_ID = 'mgd-notif-test'
const AGENT_ID = 'agt-test-mn'
const STAFF_PHONE = '+6581234567'

interface SentMsg {
  to: string
  text?: string
}

const sent: SentMsg[] = []
const recordedPings: Array<{ conversationId: string; staffUserId: string; askingAgentId: string }> = []

interface FakeChannelInstance {
  id: string
  organizationId: string
  channel: string
  role: 'staff' | 'customer'
  status: string | null
  config: Record<string, unknown>
}

const notifInstance: FakeChannelInstance = {
  id: NOTIF_INSTANCE_ID,
  organizationId: ORG,
  channel: 'whatsapp_notif',
  role: 'staff',
  status: 'active',
  config: {
    mode: 'managed-notif',
    organizationId: ORG,
    platformChannelId: 'plat-test',
    platformBaseUrl: 'http://test.local',
    environment: 'staging',
  },
}

let installedNotifChannel = true

function installStubs(): void {
  installChannelInstancesService({
    list: async (organizationId: string, channel?: string) => {
      if (organizationId !== ORG) return []
      if (channel && channel !== 'whatsapp_notif') return []
      // biome-ignore lint/suspicious/noExplicitAny: stub returning subset of ChannelInstance
      return installedNotifChannel ? [notifInstance as any] : []
    },
    get: async () => null,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    create: async () => notifInstance as any,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    update: async () => notifInstance as any,
    remove: async () => undefined,
  })

  // Stub adapter — capture sends, success-or-fail per a switch.
  let nextSendOk = true
  const stub: ChannelAdapter = {
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
      sent.push({ to: msg.to, text: msg.text })
      return nextSendOk
        ? { success: true as const, messageId: 'stub' }
        : { success: false as const, code: 'stub_fail' as never, error: 'stub' }
    },
  }
  // Expose nextSendOk via a global helper
  ;(globalThis as unknown as { __setStubSendOk: (ok: boolean) => void }).__setStubSendOk = (ok: boolean) => {
    nextSendOk = ok
  }
  registerAdapter('whatsapp_notif', () => stub, stub.capabilities)

  // Staff service stub: 3 fixed staff.
  installStaffService({
    list: async () => [],
    find: async (userId: string) => {
      const lastSeenOffline = new Date(Date.now() - 10 * 60 * 1000)
      const lastSeenOnline = new Date()
      // biome-ignore lint/suspicious/noExplicitAny: cross-module stub
      const make = (overrides: Record<string, unknown>): any => ({
        userId,
        organizationId: ORG,
        displayName: userId,
        title: null,
        sectors: [],
        expertise: [],
        languages: [],
        capacity: 10,
        availability: 'active',
        attributes: {},
        profile: '',
        memory: '',
        lastSeenAt: lastSeenOffline,
        whatsappPhoneE164: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      })
      if (userId === STAFF_X) return make({ whatsappPhoneE164: STAFF_PHONE })
      if (userId === STAFF_NO_PHONE) return make({ whatsappPhoneE164: null })
      if (userId === STAFF_ONLINE) return make({ whatsappPhoneE164: STAFF_PHONE, lastSeenAt: lastSeenOnline })
      return null
    },
    // biome-ignore lint/suspicious/noExplicitAny: stub
    get: async () => null as any,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    upsert: async (i) => i as any,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    update: async (id, p) => ({ userId: id, ...p }) as any,
    remove: async () => undefined,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    setAttributes: async (id) => ({ userId: id }) as any,
    touchLastSeen: async () => undefined,
    readMemory: async () => '',
    writeMemory: async () => undefined,
    upsertMemorySection: async () => undefined,
    readProfile: async () => '',
    writeProfile: async () => undefined,
  })

  installNotificationPrefsService({
    get: async (userId: string) => ({
      userId,
      mentionsEnabled: true,
      whatsappEnabled: true,
      emailEnabled: false,
      updatedAt: new Date(),
    }),
    upsert: async (userId) => ({
      userId,
      mentionsEnabled: true,
      whatsappEnabled: true,
      emailEnabled: false,
      updatedAt: new Date(),
    }),
  })

  // Stub pending-mention-pings: capture recordPing calls.
  const pingStub: PendingMentionPingService = {
    recordPing: async (input) => {
      recordedPings.push({
        conversationId: input.conversationId,
        staffUserId: input.staffUserId,
        askingAgentId: input.askingAgentId,
      })
    },
    claimPing: async () => null,
    pruneOlderThan: async () => 0,
  }
  installPendingMentionPingService(pingStub)

  // The system-under-test
  installMentionNotifyService(createMentionNotifyService({ db: null as unknown }))
}

beforeAll(() => {
  installStubs()
})

afterAll(() => {
  __resetChannelInstancesServiceForTests()
  __resetChannelRegistryForTests()
  __resetStaffServiceForTests()
  __resetNotificationPrefsServiceForTests()
  __resetPendingMentionPingServiceForTests()
  __resetMentionNotifyServiceForTests()
})

afterEach(() => {
  sent.length = 0
  recordedPings.length = 0
  installedNotifChannel = true
  ;(globalThis as unknown as { __setStubSendOk: (ok: boolean) => void }).__setStubSendOk(true)
})

// biome-ignore lint/suspicious/noExplicitAny: minimal note shape for the fan-out
function makeAgentNote(mentions: string[]): any {
  return {
    id: 'note-test',
    organizationId: ORG,
    conversationId: 'conv-test',
    authorType: 'agent',
    authorId: AGENT_ID,
    body: 'Need answer',
    mentions,
    parentNoteId: null,
    createdAt: new Date(),
  }
}

describe('mention-notify rewrite (Unit 8)', () => {
  it('sends WA + records ping when agent mentions an offline staff with phone', async () => {
    const result = await fanOutNoteMentions(makeAgentNote([`staff:${STAFF_X}`]))
    expect(result.notified).toEqual([STAFF_X])
    expect(sent).toEqual([{ to: STAFF_PHONE, text: expect.stringContaining('mentioned') }])
    expect(recordedPings).toEqual([{ conversationId: 'conv-test', staffUserId: STAFF_X, askingAgentId: AGENT_ID }])
  })

  it('skips staff with no whatsappPhoneE164', async () => {
    const result = await fanOutNoteMentions(makeAgentNote([`staff:${STAFF_NO_PHONE}`]))
    expect(result.notified).toEqual([])
    expect(result.skipped[0]?.reason).toBe('no_whatsapp_phone')
    expect(sent.length).toBe(0)
    expect(recordedPings.length).toBe(0)
  })

  it('skips when staff is online (recent lastSeenAt)', async () => {
    const result = await fanOutNoteMentions(makeAgentNote([`staff:${STAFF_ONLINE}`]))
    expect(result.notified).toEqual([])
    expect(result.skipped[0]?.reason).toBe('online')
    expect(sent.length).toBe(0)
  })

  it('skips when no notification channel claimed', async () => {
    installedNotifChannel = false
    const result = await fanOutNoteMentions(makeAgentNote([`staff:${STAFF_X}`]))
    expect(result.notified).toEqual([])
    expect(result.skipped[0]?.reason).toBe('no_notification_channel')
    expect(recordedPings.length).toBe(0)
  })

  it('does NOT record ping when WA send fails', async () => {
    ;(globalThis as unknown as { __setStubSendOk: (ok: boolean) => void }).__setStubSendOk(false)
    const result = await fanOutNoteMentions(makeAgentNote([`staff:${STAFF_X}`]))
    expect(result.skipped[0]?.reason).toBe('adapter_error')
    expect(sent.length).toBe(1)
    expect(recordedPings.length).toBe(0)
  })

  it('does NOT record ping when staff authored the note (no asking agent to wake)', async () => {
    // delta C8: WHEN semantics preserved — staff-authored notes still attempt
    // the WA send, but no ping row is written (no agent to resume).
    const result = await fanOutNoteMentions({
      id: 'note-test',
      organizationId: ORG,
      conversationId: 'conv-test',
      authorType: 'staff',
      authorId: 'usr-test-author',
      body: 'FYI',
      mentions: [`staff:${STAFF_X}`],
      parentNoteId: null,
      createdAt: new Date(),
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub for InternalNote
    } as any)
    expect(result.notified).toEqual([STAFF_X])
    expect(sent.length).toBe(1)
    expect(recordedPings.length).toBe(0)
  })
})
