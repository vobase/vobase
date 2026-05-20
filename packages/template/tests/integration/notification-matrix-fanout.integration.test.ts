/**
 * Integration test for the notification matrix fan-out.
 *
 * Stages a verified staff user with a sparse matrix
 * `{ mention: { in_app: true, whatsapp: false, email: true } }` and fires the
 * mention fan-out. Asserts:
 *
 *   - a `notification.suppressed` event is emitted for the disabled WA cell
 *     (the matrix override beats the defaults), so the conversation timeline
 *     records *why* no WA ping went out
 *   - the WhatsApp template send is NOT called
 *   - email-fallback is NOT called either, because that fallback fires only
 *     when the user is `phoneUnverified` — when WA is gated off by an explicit
 *     pref we just skip silently
 *
 * Mirrors the shape of `notification-events-fanout.integration.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
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

const ORG = 'org-matrix-fanout'
const STAFF = 'usr-matrix-verified'
const STAFF_PHONE = '+6581234567'
const CONV_ID = 'conv-matrix-fanout'
const AGENT_ID = 'agt-matrix-fanout'

interface CapturedEvent {
  type: string
  conversationId: string
  payload: Record<string, unknown> | null
}

const captured: CapturedEvent[] = []
let sendTemplateCalls = 0
let emailFallbackCalls = 0

const stubSendTemplate: SendTemplateFn = async () => {
  sendTemplateCalls += 1
  return { ok: true, messageId: 'stub-wamid-matrix', wireRoute: 'template' as const }
}

const stubEmailFallback: SendEmailFallbackFn = async () => {
  emailFallbackCalls += 1
  return { ok: true }
}

function installStubs(): void {
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

  // STAFF is verified — verification gating returns it under `verified`.
  installVerificationGating(async (staffIds) => ({ verified: staffIds, unverified: [] }))

  installStaffService({
    list: async () => [],
    find: async (userId: string) => {
      if (userId !== STAFF) return null
      const offline = new Date(Date.now() - 10 * 60 * 1000)
      // biome-ignore lint/suspicious/noExplicitAny: cross-module stub
      const base: any = {
        userId,
        organizationId: ORG,
        displayName: 'Alice Matrix',
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
        phoneNumberVerified: true,
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

  // Sparse matrix: mention.whatsapp explicitly false; mention.email true;
  // mention.in_app true. Other kinds left to defaults (which `getPrefs` fills
  // before the fan-out reads).
  installNotificationPrefsService({
    get: async (userId: string) => ({
      userId,
      prefs: {
        mention: { in_app: true, whatsapp: false, email: true },
        approval: { in_app: true, whatsapp: true, email: false },
        proposal: { in_app: true, whatsapp: true, email: false },
        admin_alert: { in_app: true, whatsapp: true, email: false },
      },
      updatedAt: new Date(),
    }),
    upsert: async (userId, matrix) => ({ userId, prefs: matrix, updatedAt: new Date() }),
    isEnabled: async (_userId, kind, channel) => {
      if (kind === 'mention' && channel === 'whatsapp') return false
      if (kind === 'mention' && channel === 'email') return true
      return true
    },
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
  __resetStaffServiceForTests()
  __resetNotificationPrefsServiceForTests()
  __resetPendingStaffPingServiceForTests()
  __resetMentionNotifyServiceForTests()
})

beforeEach(() => {
  captured.length = 0
  sendTemplateCalls = 0
  emailFallbackCalls = 0
})

// biome-ignore lint/suspicious/noExplicitAny: minimal note shape for the fan-out
function makeNote(mentions: string[]): any {
  return {
    id: 'note-matrix',
    organizationId: ORG,
    conversationId: CONV_ID,
    authorType: 'agent',
    authorId: AGENT_ID,
    body: 'Please review',
    mentions,
  }
}

describe('mention fan-out: matrix WhatsApp opt-out', () => {
  it('skips WA send + emits notification.suppressed when matrix mention.whatsapp = false', async () => {
    const result = await fanOutNoteMentions(makeNote([`staff:${STAFF}`]))

    // No WA template + no email fallback were called — the matrix gates WA off
    // and the email-fallback path only fires for `phoneUnverified` skips.
    expect(sendTemplateCalls).toBe(0)
    expect(emailFallbackCalls).toBe(0)

    // Fan-out reports a single skip with reason `channel_disabled` (matrix opt-out).
    expect(result.notified).toEqual([])
    expect(result.skipped).toEqual([{ userId: STAFF, reason: 'channel_disabled' }])

    // The conversation timeline gets a `notification.suppressed` row with
    // suppressionReason='paused' (the staff-ping helper's encoding of an
    // opt-out skip; see `emitMentionSuppressed` in `team/service/staff-ping.ts`).
    const suppressed = captured.filter((e) => e.type === 'notification.suppressed')
    expect(suppressed.length).toBe(1)
    expect(suppressed[0]?.conversationId).toBe(CONV_ID)
    expect(suppressed[0]?.payload?.kind).toBe('mention')
    expect(suppressed[0]?.payload?.channel).toBe('whatsapp')
    expect(suppressed[0]?.payload?.recipientStaffId).toBe(STAFF)
    expect(suppressed[0]?.payload?.recipientDisplayName).toBe('Alice Matrix')
    expect(suppressed[0]?.payload?.suppressionReason).toBe('paused')
  })
})
