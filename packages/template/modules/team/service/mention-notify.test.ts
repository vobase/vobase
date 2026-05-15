/**
 * Unit tests for the mention-notify rewrite (Unit 8).
 *
 * Covers the WHERE/WHO contract:
 *   - sends through `findNotificationChannel` (NOT the customer-WA channel)
 *   - dials the staff member's `phoneNumber` (joined from the better-auth user)
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
  __resetNotificationPrefsServiceForTests,
  installNotificationPrefsService,
} from '@modules/settings/service/notification-prefs'
import type { HarnessLogger } from '@vobase/core'

import {
  __resetMentionNotifyServiceForTests,
  createMentionNotifyService,
  FANOUT_MENTION_PINGS_JOB,
  FanOutMentionPingsPayloadSchema,
  fanOutNoteMentions,
  installMentionNotifyService,
  type SendTemplateFn,
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
  bodyParams: [string, string, string]
  buttonUrlSuffix: string
}

const sent: SentMsg[] = []
let nextSendOk = true

const stubSendTemplate: SendTemplateFn = async ({ staffPhoneE164, bodyParams, buttonUrlSuffix }) => {
  sent.push({ to: staffPhoneE164, bodyParams, buttonUrlSuffix })
  if (!nextSendOk) throw new Error('stub_fail')
  return { ok: true, messageId: 'stub' }
}
const recordedPings: Array<{
  conversationId: string
  staffUserId: string
  askingAgentId: string
  outboundWamid: string | null | undefined
}> = []

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

  // The platform-call seam used to be an adapter behind the channel
  // registry; now it's a DI'd `sendTemplate` closure on the service. Tests
  // capture sends + toggle success via the `stubSendTemplate` closed-over
  // `nextSendOk` flag declared at module scope.

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
        phoneNumber: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      })
      if (userId === STAFF_X) return make({ phoneNumber: STAFF_PHONE })
      if (userId === STAFF_NO_PHONE) return make({ phoneNumber: null })
      if (userId === STAFF_ONLINE) return make({ phoneNumber: STAFF_PHONE, lastSeenAt: lastSeenOnline })
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
        outboundWamid: input.outboundWamid,
      })
    },
    claimPing: async () => ({ status: 'none' as const }),
    pruneOlderThan: async () => 0,
  }
  installPendingMentionPingService(pingStub)

  // The system-under-test
  installMentionNotifyService(createMentionNotifyService({ db: null as unknown, sendTemplate: stubSendTemplate }))
}

beforeAll(() => {
  installStubs()
})

afterAll(() => {
  __resetChannelInstancesServiceForTests()
  __resetStaffServiceForTests()
  __resetNotificationPrefsServiceForTests()
  __resetPendingMentionPingServiceForTests()
  __resetMentionNotifyServiceForTests()
})

afterEach(() => {
  sent.length = 0
  recordedPings.length = 0
  installedNotifChannel = true
  nextSendOk = true
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
    expect(sent.length).toBe(1)
    expect(sent[0]?.to).toBe(STAFF_PHONE)
    expect(sent[0]?.bodyParams[1]).toBe('Need answer')
    expect(recordedPings).toEqual([
      { conversationId: 'conv-test', staffUserId: STAFF_X, askingAgentId: AGENT_ID, outboundWamid: 'stub' },
    ])
  })

  it('skips staff with no phoneNumber', async () => {
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
    nextSendOk = false
    const result = await fanOutNoteMentions(makeAgentNote([`staff:${STAFF_X}`]))
    expect(result.skipped[0]?.reason).toBe('stub_fail')
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

describe('mention-notify enqueueFanOut', () => {
  it('enqueues FANOUT_MENTION_PINGS_JOB with the note and a per-note singletonKey', async () => {
    const sends: Array<{ name: string; data: unknown; opts?: { singletonKey?: string } }> = []
    const svc = createMentionNotifyService({
      db: null as unknown,
      jobs: {
        send: (name, data, opts) => {
          sends.push({ name, data, opts })
          return Promise.resolve('job-1')
        },
      },
    })
    const note = makeAgentNote([`staff:${STAFF_X}`])
    await svc.enqueueFanOut(note)
    expect(sends).toHaveLength(1)
    expect(sends[0]?.name).toBe(FANOUT_MENTION_PINGS_JOB)
    // Payload carries only the fan-out's consumed fields — `createdAt` /
    // `parentNoteId` are dropped (see `enqueueFanOut`).
    expect(sends[0]?.data).toEqual({
      note: {
        id: 'note-test',
        organizationId: ORG,
        conversationId: 'conv-test',
        authorType: 'agent',
        authorId: AGENT_ID,
        body: 'Need answer',
        mentions: [`staff:${STAFF_X}`],
      },
    })
    expect(sends[0]?.opts?.singletonKey).toBe(`fanout-mention:${note.id}`)
  })

  it('no-ops when no jobs queue is wired (unit-test boot)', async () => {
    const svc = createMentionNotifyService({ db: null as unknown })
    // Must not throw — mirrors `syncStaffLinksEnqueue`'s no-scheduler tolerance.
    await svc.enqueueFanOut(makeAgentNote([`staff:${STAFF_X}`]))
  })

  it('FanOutMentionPingsPayloadSchema parses a JSON-round-tripped payload and strips non-consumed fields', () => {
    // `makeAgentNote` carries `createdAt: Date` + `parentNoteId` — fields the
    // fan-out never reads. After JSON round-trip they must not break the parse.
    const note = makeAgentNote([`staff:${STAFF_X}`])
    const roundTripped = JSON.parse(JSON.stringify({ note })) as unknown
    const parsed = FanOutMentionPingsPayloadSchema.parse(roundTripped)
    expect(parsed.note.id).toBe('note-test')
    expect(parsed.note.mentions).toEqual([`staff:${STAFF_X}`])
    expect('createdAt' in parsed.note).toBe(false)
    expect('parentNoteId' in parsed.note).toBe(false)
  })
})
