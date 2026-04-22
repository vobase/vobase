/**
 * Integration tests for the Model A conversations service.
 * Requires Docker Postgres running (see `tests/helpers/test-db.ts`).
 *
 * Covers:
 *   - unique-constraint `resumeOrCreate` idempotency (one row per pair)
 *   - snooze / unsnooze / wakeSnoozed idempotency
 *   - resolve / reopen / reset transitions
 *   - inbound-wakes-resolved auto-flip
 *   - inbound-rejects-failed
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import { setDb as setJournalDb } from '@modules/agents/service/journal'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_ORG_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import {
  ConversationFailedError,
  createConversationsService,
  createInboundMessage,
  get,
  installConversationsService,
  reopen,
  reset,
  resolve,
  resumeOrCreate,
  SnoozeNotAllowedError,
  snooze,
  unsnooze,
  wakeSnoozed,
} from '@modules/inbox/service/conversations'
import { createMessagesService, installMessagesService } from '@modules/inbox/service/messages'
import { and, eq } from 'drizzle-orm'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../../tests/helpers/test-db'

let db: TestDbHandle
const schedulerCalls: Array<{ op: string; args: unknown }> = []
const jobIds = new Map<string, number>()
let nextJobId = 1

function fakeScheduler() {
  return {
    send: async (name: string, data: Record<string, unknown>, opts?: { startAfter?: Date }) => {
      const id = `job-${nextJobId++}`
      jobIds.set(id, Date.now())
      schedulerCalls.push({ op: 'send', args: { name, data, opts } })
      return id
    },
    cancel: async (jobId: string) => {
      jobIds.delete(jobId)
      schedulerCalls.push({ op: 'cancel', args: jobId })
    },
  }
}

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  installConversationsService(createConversationsService({ db: db.db, scheduler: fakeScheduler() }))
  setJournalDb(db.db)
  installMessagesService(createMessagesService({ db: db.db }))
})

afterAll(async () => {
  if (db) await db.teardown()
})

beforeEach(() => {
  schedulerCalls.length = 0
})

describe('resumeOrCreate (Model A uniqueness)', () => {
  it('returns the same row across calls for the same (organization, contact, channelInstance)', async () => {
    const a = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    const b = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    expect(a.conversation.id).toBe(b.conversation.id)
    expect(b.created).toBe(false)
  })

  it('returns the same row even if status was flipped to resolved', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await resolve(conversation.id, 'test', 'answered')
    const again = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    expect(again.conversation.id).toBe(conversation.id)
    expect(again.created).toBe(false)
  })

  it('distinct threadKeys coexist on the same (organization, contact, channelInstance) — email topic isolation', async () => {
    // Chat channels default to threadKey='default' (one row per pair).
    // Email-style: two RFC 5322 thread roots → two separate conversations
    // on the same (organization, contact, channel_instance).
    const booking = await resumeOrCreate(
      MERIDIAN_ORG_ID,
      SEEDED_CONTACT_ID,
      CUSTOMER_CHANNEL_INSTANCE_ID,
      'thread:<booking-2026-04@example.com>',
    )
    const billing = await resumeOrCreate(
      MERIDIAN_ORG_ID,
      SEEDED_CONTACT_ID,
      CUSTOMER_CHANNEL_INSTANCE_ID,
      'thread:<billing-2026-04@example.com>',
    )
    expect(booking.conversation.id).not.toBe(billing.conversation.id)
    expect(booking.conversation.threadKey).toBe('thread:<booking-2026-04@example.com>')
    expect(billing.conversation.threadKey).toBe('thread:<billing-2026-04@example.com>')

    // Repeated calls with the same threadKey are idempotent.
    const bookingAgain = await resumeOrCreate(
      MERIDIAN_ORG_ID,
      SEEDED_CONTACT_ID,
      CUSTOMER_CHANNEL_INSTANCE_ID,
      'thread:<booking-2026-04@example.com>',
    )
    expect(bookingAgain.conversation.id).toBe(booking.conversation.id)
    expect(bookingAgain.created).toBe(false)
  })
})

describe('resolve / reopen / reset transitions', () => {
  it('active → resolved via resolve(); then resolved → active via reopen()', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    // ensure active
    await reopen(conversation.id, 'test', 'staff_reopen').catch(() => undefined)

    const resolved = await resolve(conversation.id, 'alice', 'handled')
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolvedReason).toBe('handled')

    const reopened = await reopen(conversation.id, 'alice', 'staff_reopen')
    expect(reopened.status).toBe('active')
    expect(reopened.resolvedAt).toBeNull()
  })
})

describe('snooze / unsnooze / wakeSnoozed', () => {
  it('snooze writes fields + enqueues job; unsnooze clears + cancels', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await reopen(conversation.id, 'test', 'staff_reopen').catch(() => undefined)

    const until = new Date(Date.now() + 3600_000)
    const snoozed = await snooze({ conversationId: conversation.id, until, by: 'alice', reason: 'lunch' })
    expect(snoozed.snoozedUntil?.getTime()).toBe(until.getTime())
    expect(snoozed.snoozedReason).toBe('lunch')
    expect(snoozed.snoozedBy).toBe('alice')
    expect(snoozed.snoozedJobId).toBeTruthy()
    expect(schedulerCalls.some((c) => c.op === 'send')).toBe(true)

    const un = await unsnooze(conversation.id, 'alice')
    expect(un.snoozedUntil).toBeNull()
    expect(un.snoozedJobId).toBeNull()
    expect(schedulerCalls.some((c) => c.op === 'cancel')).toBe(true)
  })

  it('rejects snooze on non-active status', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await resolve(conversation.id, 'alice', 'test')
    await expect(
      snooze({ conversationId: conversation.id, until: new Date(Date.now() + 3600_000), by: 'alice' }),
    ).rejects.toBeInstanceOf(SnoozeNotAllowedError)
    await reopen(conversation.id, 'alice', 'staff_reopen')
  })

  it('wakeSnoozed is idempotent via snoozedAt match', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    const until = new Date(Date.now() + 3600_000)
    await snooze({ conversationId: conversation.id, until, by: 'alice' })

    const current = await get(conversation.id)
    expect(current.snoozedAt).not.toBeNull()
    if (!current.snoozedAt) throw new Error('snoozedAt missing')
    const correctIso = current.snoozedAt.toISOString()

    // Wrong timestamp: no-op
    const stale = await wakeSnoozed(conversation.id, new Date(Date.now() - 1000).toISOString())
    expect(stale.woken).toBe(false)

    // Correct timestamp: wakes
    const ok = await wakeSnoozed(conversation.id, correctIso)
    expect(ok.woken).toBe(true)

    const after = await get(conversation.id)
    expect(after.snoozedUntil).toBeNull()
  })
})

describe('createInboundMessage lifecycle', () => {
  it('inbound on resolved flips to active + writes reopened event', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await resolve(conversation.id, 'alice', 'done')

    const res = await createInboundMessage({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: `wake-resolved-${Date.now()}`,
      content: 'hi again',
      contentType: 'text',
    })
    expect(res.conversation.status).toBe('active')
    expect(res.conversation.resolvedAt).toBeNull()

    const { conversationEvents } = await import('@modules/agents/schema')
    const events = await db.db
      .select()
      .from(conversationEvents)
      .where(
        and(
          eq(conversationEvents.conversationId, conversation.id),
          eq(conversationEvents.type, 'conversation.reopened'),
        ),
      )
    expect(events.length).toBeGreaterThanOrEqual(1)
  })

  it('inbound on failed is rejected (no auto-wake)', async () => {
    // Manually set status to failed
    const { conversations: convTable } = await import('@modules/inbox/schema')
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await db.db.update(convTable).set({ status: 'failed' }).where(eq(convTable.id, conversation.id))

    await expect(
      createInboundMessage({
        organizationId: MERIDIAN_ORG_ID,
        channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
        contactId: SEEDED_CONTACT_ID,
        externalMessageId: `wake-failed-${Date.now()}`,
        content: 'ping',
        contentType: 'text',
      }),
    ).rejects.toBeInstanceOf(ConversationFailedError)

    // reset unblocks further inbound
    const after = await reset(conversation.id, 'alice')
    expect(after.status).toBe('active')
  })

  it('inbound on snoozed conversation clears snooze + cancels job', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await reopen(conversation.id, 'test', 'staff_reopen').catch(() => undefined)
    await snooze({ conversationId: conversation.id, until: new Date(Date.now() + 3600_000), by: 'alice' })
    schedulerCalls.length = 0

    const res = await createInboundMessage({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: `wake-snoozed-${Date.now()}`,
      content: 'customer replied',
      contentType: 'text',
    })
    expect(res.conversation.snoozedUntil).toBeNull()
    expect(schedulerCalls.some((c) => c.op === 'cancel')).toBe(true)
  })
})

describe('list() preview', () => {
  it('returns lastMessagePreview + kind + role from latest message', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await createInboundMessage({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: `preview-${Date.now()}`,
      content: 'latest text from customer',
      contentType: 'text',
    })

    const { list } = await import('@modules/inbox/service/conversations')
    const rows = await list(MERIDIAN_ORG_ID)
    const row = rows.find((r) => r.id === conversation.id)
    expect(row).toBeDefined()
    expect(row?.lastMessagePreview).toBe('latest text from customer')
    expect(row?.lastMessageKind).toBe('text')
    expect(row?.lastMessageRole).toBe('customer')
  })
})

// silence unused
void MERIDIAN_AGENT_ID
