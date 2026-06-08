import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetChannelInstancesServiceForTests,
  installChannelInstancesService,
} from '@modules/channels/service/instances'
import {
  __resetNotificationPrefsServiceForTests,
  installNotificationPrefsService,
} from '@modules/settings/service/notification-prefs'
import { __resetVerificationGatingForTests, installVerificationGating } from '@modules/team/service/mention-notify'
import {
  __resetPendingStaffPingServiceForTests,
  installPendingStaffPingService,
} from '@modules/team/service/pending-staff-pings'
import { __resetStaffServiceForTests, installStaffService } from '@modules/team/service/staff'
import {
  __resetMentionNotifyServiceForTests,
  createMentionNotifyService,
  fanOutNoteMentions,
  installMentionNotifyService,
  type SendEmailFallbackFn,
  type SendTemplateFn,
} from '@modules/team/service/staff-ping'
import { installJournalService, type JournalAppendInput, type JournalEventLike } from '@vobase/core'

const ORG = 'org-notif-events'
const STAFF_VERIFIED = 'usr-notif-verified'
const STAFF_UNVERIFIED = 'usr-notif-unverified'
const STAFF_PHONE = '+6581234567'
const CONV_ID = 'conv-notif-events'
const AGENT_ID = 'agt-notif-test'

interface CapturedEvent {
  type: string
  conversationId: string
  payload: Record<string, unknown> | null
}

const captured: CapturedEvent[] = []

const stubSendTemplate: SendTemplateFn = async () => ({
  ok: true,
  messageId: 'stub-wamid-events',
  wireRoute: 'template' as const,
})

const stubEmailFallback: SendEmailFallbackFn = async () => ({ ok: true })

function installStubs(): void {
  // Captor journal: records every `append` call so the assertions can read
  // back the `notification.*` rows the fan-out emits.
  installJournalService({
    append: async <E extends JournalEventLike>(input: JournalAppendInput<E>) => {
      const ev = input.event as unknown as Record<string, unknown>
      captured.push({
        type: ev.type as string,
        conversationId: input.conversationId,
        payload: (ev.payload as Record<string, unknown> | null) ?? null,
      })
    },
    getLastWakeTail: async () => ({ interrupted: false }),
    getLatestTurnIndex: async () => 0,
  })

  installVerificationGating(async (staffIds) => {
    const verified = staffIds.filter((id) => id === STAFF_VERIFIED)
    const unverified = staffIds.filter((id) => id !== STAFF_VERIFIED)
    return { verified, unverified }
  })

  installChannelInstancesService({
    list: async (organizationId: string, channel?: string) => {
      if (organizationId !== ORG) return []
      if (channel && channel !== 'whatsapp_notif') return []
      return [
        {
          id: 'notif-inst',
          organizationId: ORG,
          channel: 'whatsapp_notif',
          role: 'staff',
          status: 'active',
          config: { mode: 'managed', kind: 'notification', organizationId: ORG, platformChannelId: 'plat-test' },
          // biome-ignore lint/suspicious/noExplicitAny: stub returning subset of ChannelInstance
        } as any,
      ]
    },
    get: async () => null,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    create: async () => null as any,
    // biome-ignore lint/suspicious/noExplicitAny: stub
    update: async () => null as any,
    remove: async () => undefined,
    updateConfigAtomic: async () => null,
    hardRemove: async () => undefined,
  })

  installStaffService({
    list: async () => [],
    find: async (userId: string) => {
      if (userId !== STAFF_VERIFIED && userId !== STAFF_UNVERIFIED) return null
      const offline = new Date(Date.now() - 10 * 60 * 1000)
      // biome-ignore lint/suspicious/noExplicitAny: cross-module stub
      const base: any = {
        userId,
        organizationId: ORG,
        displayName: userId === STAFF_VERIFIED ? 'Alice Verified' : 'Bob Unverified',
        title: null,
        sectors: [],
        expertise: [],
        languages: [],
        capacity: 10,
        availability: 'active',
        attributes: {},
        profile: '',
        memory: '',
        lastSeenAt: offline,
        phoneNumber: STAFF_PHONE,
        phoneNumberVerified: userId === STAFF_VERIFIED,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      return base
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
        mention: { in_app: true, whatsapp: true, email: true },
        approval: { in_app: true, whatsapp: true, email: true },
        proposal: { in_app: true, whatsapp: true, email: true },
        admin_alert: { in_app: true, whatsapp: true, email: true },
      },
      notifyWhileOnline: false,
      updatedAt: new Date(),
    }),
    upsert: async (userId, matrix, notifyWhileOnline) => ({
      userId,
      prefs: matrix,
      notifyWhileOnline,
      updatedAt: new Date(),
    }),
    isEnabled: async () => true,
  })

  installPendingStaffPingService({
    recordPing: async () => undefined,
    claimPing: async () => ({ status: 'none' as const }),
    pruneOlderThan: async () => 0,
  })

  installMentionNotifyService(
    createMentionNotifyService({
      db: null as unknown,
      sendTemplate: stubSendTemplate,
      sendEmailFallback: stubEmailFallback,
    }),
  )
}

beforeAll(() => {
  installStubs()
})

afterAll(() => {
  __resetVerificationGatingForTests()
  __resetChannelInstancesServiceForTests()
  __resetStaffServiceForTests()
  __resetNotificationPrefsServiceForTests()
  __resetPendingStaffPingServiceForTests()
  __resetMentionNotifyServiceForTests()
})

beforeEach(() => {
  captured.length = 0
})

// biome-ignore lint/suspicious/noExplicitAny: minimal note shape for the fan-out
function makeNote(mentions: string[]): any {
  return {
    id: 'note-notif-events',
    organizationId: ORG,
    conversationId: CONV_ID,
    authorType: 'agent',
    authorId: AGENT_ID,
    body: 'Please review',
    mentions,
  }
}

describe('mention fan-out: notification.* timeline events', () => {
  it('emits notification.sent for a verified recipient', async () => {
    await fanOutNoteMentions(makeNote([`staff:${STAFF_VERIFIED}`]))
    const sent = captured.filter((e) => e.type === 'notification.sent')
    expect(sent.length).toBe(1)
    expect(sent[0]?.conversationId).toBe(CONV_ID)
    expect(sent[0]?.payload?.kind).toBe('mention')
    expect(sent[0]?.payload?.channel).toBe('whatsapp')
    expect(sent[0]?.payload?.recipientStaffId).toBe(STAFF_VERIFIED)
    expect(sent[0]?.payload?.recipientDisplayName).toBe('Alice Verified')
    expect(sent[0]?.payload?.messageId).toBe('stub-wamid-events')
  })

  it('emits notification.suppressed with suppressionReason=unverified for an unverified recipient', async () => {
    await fanOutNoteMentions(makeNote([`staff:${STAFF_UNVERIFIED}`]))
    const suppressed = captured.filter((e) => e.type === 'notification.suppressed')
    expect(suppressed.length).toBe(1)
    expect(suppressed[0]?.conversationId).toBe(CONV_ID)
    expect(suppressed[0]?.payload?.kind).toBe('mention')
    expect(suppressed[0]?.payload?.channel).toBe('whatsapp')
    expect(suppressed[0]?.payload?.recipientStaffId).toBe(STAFF_UNVERIFIED)
    expect(suppressed[0]?.payload?.recipientDisplayName).toBe('Bob Unverified')
    expect(suppressed[0]?.payload?.suppressionReason).toBe('unverified')
  })

  it('mixed verified + unverified mentions emit one event per recipient', async () => {
    await fanOutNoteMentions(makeNote([`staff:${STAFF_VERIFIED}`, `staff:${STAFF_UNVERIFIED}`]))
    const sent = captured.filter((e) => e.type === 'notification.sent')
    const suppressed = captured.filter((e) => e.type === 'notification.suppressed')
    expect(sent.length).toBe(1)
    expect(suppressed.length).toBe(1)
    expect(sent[0]?.payload?.recipientStaffId).toBe(STAFF_VERIFIED)
    expect(suppressed[0]?.payload?.recipientStaffId).toBe(STAFF_UNVERIFIED)
  })
})
