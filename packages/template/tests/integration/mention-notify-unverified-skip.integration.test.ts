/**
 * Integration: mention fan-out gates on `auth.user.phoneNumberVerified`.
 *
 * US-021 AC: given staff A (verified) and B (unverified), an
 * `@staff:A @staff:B` mention must:
 *   - deliver exactly 1 WhatsApp send (to A)
 *   - return A in `result.notified`, B in `result.skipped` with
 *     `reason: 'phone_unverified'`
 *   - fire exactly 1 email-fallback invocation (for B)
 *
 * This test uses service stubs throughout (no real Postgres) — the DB query
 * inside `createVerificationGating` is unit-tested separately; here we verify
 * the fan-out wiring: the gating seam, the email-fallback seam, and the
 * result shape all compose correctly.
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

const ORG = 'org-unverified-test'
const STAFF_A = 'usr-verified'
const STAFF_B = 'usr-unverified'
const AGENT_ID = 'agt-test-uv'
const STAFF_A_PHONE = '+6581234567'

interface SentMsg {
  to: string
}
const sent: SentMsg[] = []
const emailFallbackCalls: string[] = []

const stubSendTemplate: SendTemplateFn = async ({ staffPhoneE164 }) => {
  sent.push({ to: staffPhoneE164 })
  return { ok: true, messageId: 'stub-wamid', wireRoute: 'template' as const }
}

const stubEmailFallback: SendEmailFallbackFn = async ({ staffUserId }) => {
  emailFallbackCalls.push(staffUserId)
  return { ok: true }
}

function installStubs(): void {
  // Verification gating stub: A is verified, B is not.
  installVerificationGating(async (staffIds, _orgId) => {
    const verified = staffIds.filter((id) => id === STAFF_A)
    const unverified = staffIds.filter((id) => id !== STAFF_A)
    return { verified, unverified }
  })

  // Notification channel stub: returns a minimal managed-notif instance.
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
          config: { mode: 'managed-notif', organizationId: ORG, platformChannelId: 'plat-test' },
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
    hardRemove: async () => undefined,
  })

  // Staff service stub: A has phone, B has phone (both offline).
  installStaffService({
    list: async () => [],
    find: async (userId: string) => {
      const lastSeenOffline = new Date(Date.now() - 10 * 60 * 1000)
      // biome-ignore lint/suspicious/noExplicitAny: cross-module stub
      const base: any = {
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
        phoneNumber: STAFF_A_PHONE,
        phoneNumberVerified: userId === STAFF_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      if (userId === STAFF_A || userId === STAFF_B) return base
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

  // Notification prefs: both staff have all channels enabled.
  installNotificationPrefsService({
    get: async (userId: string) => ({
      userId,
      mentionsEnabled: true,
      whatsappEnabled: true,
      emailEnabled: true,
      approvalsEnabled: true,
      proposalsEnabled: true,
      updatedAt: new Date(),
    }),
    upsert: async (userId: string) => ({
      userId,
      mentionsEnabled: true,
      whatsappEnabled: true,
      emailEnabled: true,
      approvalsEnabled: true,
      proposalsEnabled: true,
      updatedAt: new Date(),
    }),
  })

  // Pending-ping stub: no-op record.
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

afterEach(() => {
  sent.length = 0
  emailFallbackCalls.length = 0
})

// biome-ignore lint/suspicious/noExplicitAny: minimal note shape for the fan-out
function makeNote(mentions: string[]): any {
  return {
    id: 'note-uv-test',
    organizationId: ORG,
    conversationId: 'conv-uv-test',
    authorType: 'agent',
    authorId: AGENT_ID,
    body: 'Please handle this',
    mentions,
  }
}

describe('mention fan-out: phoneNumberVerified gating (US-021)', () => {
  it('notifies verified A, skips unverified B with reason phone_unverified', async () => {
    const result = await fanOutNoteMentions(makeNote([`staff:${STAFF_A}`, `staff:${STAFF_B}`]))

    expect(result.notified).toEqual([STAFF_A])
    expect(result.skipped.find((s) => s.userId === STAFF_B)?.reason).toBe('phone_unverified')
    expect(result.skipped.some((s) => s.userId === STAFF_A)).toBe(false)
  })

  it('sends exactly 1 platform fetch (WA) — only for verified A', async () => {
    await fanOutNoteMentions(makeNote([`staff:${STAFF_A}`, `staff:${STAFF_B}`]))
    expect(sent.length).toBe(1)
    expect(sent[0]?.to).toBe(STAFF_A_PHONE)
  })

  it('fires exactly 1 email-fallback — only for unverified B', async () => {
    await fanOutNoteMentions(makeNote([`staff:${STAFF_A}`, `staff:${STAFF_B}`]))
    expect(emailFallbackCalls.length).toBe(1)
    expect(emailFallbackCalls[0]).toBe(STAFF_B)
  })

  it('all-verified mention: no email fallback, both notified', async () => {
    // Override gating to treat everyone as verified for this test only.
    installVerificationGating(async (staffIds) => ({ verified: staffIds.slice(), unverified: [] }))
    const result = await fanOutNoteMentions(makeNote([`staff:${STAFF_A}`]))
    expect(result.notified).toEqual([STAFF_A])
    expect(emailFallbackCalls.length).toBe(0)
    // Restore for subsequent tests.
    installVerificationGating(async (staffIds, _orgId) => {
      const verified = staffIds.filter((id) => id === STAFF_A)
      const unverified = staffIds.filter((id) => id !== STAFF_A)
      return { verified, unverified }
    })
  })
})
