/**
 * Unit tests for the staff-ping rewrite (Unit 8).
 *
 * Covers the WHERE/WHO contract:
 *   - sends through `findNotificationChannel` (NOT the customer-WA channel)
 *   - dials the staff member's `phoneNumber` (joined from the better-auth user)
 *   - records a `pendingStaffPings` row ONLY on a successful WA send AND
 *     when an agent authored the note
 *
 * The integration with `addNote` post-commit fan-out is covered by
 * `tests/e2e/supervisor-mention-fanout.test.ts` already; this file isolates
 * the staff-ping side effects via stubs.
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

import {
  __resetPendingStaffPingServiceForTests as __resetPendingMentionPingServiceForTests,
  installPendingStaffPingService as installPendingMentionPingService,
  type PendingStaffPingService as PendingMentionPingService,
} from './pending-staff-pings'
import { __resetStaffServiceForTests, installStaffService } from './staff'
import {
  __resetMentionNotifyServiceForTests,
  buildTemplateForDispatch,
  createMentionNotifyService,
  FANOUT_MENTION_PINGS_JOB,
  FanOutMentionPingsPayloadSchema,
  fanOutNoteMentions,
  installMentionNotifyService,
  type SendTemplateFn,
  urlToSuffix,
} from './staff-ping'

const ORG = 'org-test-mn'
const STAFF_X = 'usr-test-mn-x'
const STAFF_NO_PHONE = 'usr-test-mn-y'
const STAFF_ONLINE = 'usr-test-mn-z'
const NOTIF_INSTANCE_ID = 'mgd-notif-test'
const AGENT_ID = 'agt-test-mn'
const STAFF_PHONE = '+6581234567'

interface SentMsg {
  to: string
  templateName: string
  bodyParams: unknown
  buttonUrlSuffix: string
}

const sent: SentMsg[] = []
let nextSendOk = true

const stubSendTemplate: SendTemplateFn = async ({ staffPhoneE164, templateName, bodyParams, buttonUrlSuffix }) => {
  sent.push({ to: staffPhoneE164, templateName, bodyParams, buttonUrlSuffix })
  if (!nextSendOk) throw new Error('stub_fail')
  return { ok: true, messageId: 'stub', wireRoute: 'template' as const }
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
    hardRemove: async () => undefined,
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
      prefs: {
        mention: { in_app: true, whatsapp: true, email: false },
        approval: { in_app: true, whatsapp: true, email: false },
        proposal: { in_app: true, whatsapp: true, email: false },
        admin_alert: { in_app: true, whatsapp: true, email: false },
      },
      updatedAt: new Date(),
    }),
    upsert: async (userId, matrix) => ({ userId, prefs: matrix, updatedAt: new Date() }),
    isEnabled: async (_uid, _k, channel) => channel !== 'email',
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

describe('staff-ping rewrite (Unit 8)', () => {
  it('sends WA + records ping when agent mentions an offline staff with phone', async () => {
    const result = await fanOutNoteMentions(makeAgentNote([`staff:${STAFF_X}`]))
    expect(result.notified).toEqual([STAFF_X])
    expect(sent.length).toBe(1)
    expect(sent[0]?.to).toBe(STAFF_PHONE)
    expect((sent[0]?.bodyParams as Record<string, string>).snippet).toBe('Need answer')
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

describe('staff-ping enqueueFanOut', () => {
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

// ─── US-011b acceptance tests ─────────────────────────────────────────────────

describe('US-011b: urlToSuffix', () => {
  it('strips the platform base URL prefix', () => {
    const url = 'https://platform.vobase.dev/auth/magic?token=abc123'
    expect(urlToSuffix(url)).toBe('auth/magic?token=abc123')
  })

  it('strips prefix for root-level path', () => {
    expect(urlToSuffix('https://platform.vobase.dev/foo')).toBe('foo')
  })

  it('throws when URL does not start with platform base', () => {
    expect(() => urlToSuffix('https://other.example.com/path')).toThrow('urlToSuffix')
  })

  it('throws for a plain relative path', () => {
    expect(() => urlToSuffix('auth/magic?token=x')).toThrow('urlToSuffix')
  })
})

describe('US-011b: buildTemplateForDispatch — metaTemplateApprovals gating', () => {
  // Template names from templateNameFor():
  //   'mention'     → 'vobase_inbox_mention_v2'  (mention IS the base/fallback template)
  //   'approval'    → 'vobase_decision_required_v2'    (merged with proposal)
  //   'proposal'    → 'vobase_decision_required_v2'    (merged with approval)
  //   'admin_alert' → 'vobase_admin_alert_v2'

  it('mention: uses vobase_inbox_mention_v2 body when its key is approved', () => {
    // mention's per-kind template IS vobase_inbox_mention_v2 — when that key is
    // marked approved, buildBodyParams (not buildFallbackBody) is used.
    const approvals: Record<string, unknown> = { vobase_inbox_mention_v2: 'approved' }
    const result = buildTemplateForDispatch('mention', { snippet: 'Hello', agentName: 'Bot' }, approvals)
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
    const body = result.bodyParams as Record<string, string>
    expect(body.agentName).toBe('Bot')
    expect(body.snippet).toBe('Hello')
  })

  it('mention: falls back (same template) when approvals is null', () => {
    const result = buildTemplateForDispatch('mention', { snippet: 'Hey', agentName: 'Bot' }, null)
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
    const body = result.bodyParams as Record<string, string>
    expect(body.agentName).toBe('Bot')
    expect(body.snippet).toBe('Hey')
  })

  it('mention: falls back when approvals is undefined', () => {
    const result = buildTemplateForDispatch('mention', { snippet: 'Hey', agentName: 'Bot' }, undefined)
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
  })

  it('approval: returns vobase_decision_required_v2 body when approved', () => {
    const approvals: Record<string, unknown> = { vobase_decision_required_v2: 'approved' }
    const result = buildTemplateForDispatch(
      'approval',
      { agentName: 'Bot', summary: 'Approve this?', detail: 'Order #42' },
      approvals,
    )
    expect(result.templateName).toBe('vobase_decision_required_v2')
    const body = result.bodyParams as Record<string, string>
    expect(body.summary).toBe('Approve this?')
    expect(body.detail).toBe('Order #42')
    expect(body.agentName).toBe('Bot')
  })

  it('approval: falls back to vobase_inbox_mention_v2 when key is pending', () => {
    const approvals: Record<string, unknown> = { vobase_decision_required_v2: 'pending' }
    const result = buildTemplateForDispatch(
      'approval',
      { agentName: 'Bot', summary: 'Approve this?', detail: 'Order #42' },
      approvals,
    )
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
    // Fallback body packs summary into snippet
    expect((result.bodyParams as Record<string, string>).snippet).toBe('Approve this?')
  })

  it('approval: falls back when key is rejected', () => {
    const approvals: Record<string, unknown> = { vobase_decision_required_v2: 'rejected' }
    const result = buildTemplateForDispatch(
      'approval',
      { agentName: 'Bot', summary: 'Approve this?', detail: 'Order #42' },
      approvals,
    )
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
  })

  it('approval: falls back when key is absent (missing = unapproved)', () => {
    const result = buildTemplateForDispatch(
      'approval',
      { agentName: 'Bot', summary: 'Approve this?', detail: 'Ctx' },
      {},
    )
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
  })

  it('approval: falls back when metaTemplateApprovals is null', () => {
    const result = buildTemplateForDispatch(
      'approval',
      { agentName: 'Bot', summary: 'Approve this?', detail: 'Ctx' },
      null,
    )
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
  })

  it('proposal: returns vobase_decision_required_v2 body when approved', () => {
    const approvals: Record<string, unknown> = { vobase_decision_required_v2: 'approved' }
    const result = buildTemplateForDispatch(
      'proposal',
      { agentName: 'Bot', summary: 'Contact #7', detail: 'Update phone' },
      approvals,
    )
    expect(result.templateName).toBe('vobase_decision_required_v2')
    const body = result.bodyParams as Record<string, string>
    expect(body.summary).toBe('Contact #7')
    expect(body.detail).toBe('Update phone')
    expect(body.agentName).toBe('Bot')
  })

  it('proposal: falls back when unapproved, packs summary into snippet', () => {
    const result = buildTemplateForDispatch(
      'proposal',
      { agentName: 'Bot', summary: 'Contact #7', detail: 'Update phone' },
      null,
    )
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
    expect((result.bodyParams as Record<string, string>).snippet).toBe('Contact #7')
  })

  it('admin_alert: returns vobase_admin_alert_v2 body when approved', () => {
    const approvals: Record<string, unknown> = { vobase_admin_alert_v2: 'approved' }
    const result = buildTemplateForDispatch(
      'admin_alert',
      { alertHeadline: 'Budget exceeded', alertDetail: '120% of cap', organizationName: 'Acme' },
      approvals,
    )
    expect(result.templateName).toBe('vobase_admin_alert_v2')
    const body = result.bodyParams as Record<string, string>
    expect(body.alertHeadline).toBe('Budget exceeded')
    expect(body.alertDetail).toBe('120% of cap')
    expect(body.organizationName).toBe('Acme')
  })

  it('admin_alert: falls back when unapproved, packs alertHeadline into snippet', () => {
    const result = buildTemplateForDispatch(
      'admin_alert',
      { alertHeadline: 'Budget exceeded', alertDetail: '120% of cap', organizationName: 'Acme' },
      null,
    )
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
    expect((result.bodyParams as Record<string, string>).snippet).toBe('Budget exceeded')
  })

  it('truncates long fallback snippets to ≤200 chars with ellipsis', () => {
    const longText = 'A'.repeat(250)
    const result = buildTemplateForDispatch('approval', { agentName: 'Bot', summary: longText }, null)
    expect(result.templateName).toBe('vobase_inbox_mention_v2')
    const body = result.bodyParams as Record<string, string>
    expect(body.snippet.length).toBeLessThanOrEqual(200)
    expect(body.snippet.endsWith('…')).toBe(true)
  })
})
