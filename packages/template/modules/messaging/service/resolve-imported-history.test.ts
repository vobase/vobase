/**
 * E2E for `resolveImportedHistory` against real Postgres (no DB mocks, per the
 * repo convention). Uses a unique synthetic org + cleans up its own rows so the
 * surrounding dev DB is left untouched (no nuke/reseed).
 *
 * Asserts the external behaviour of the onboarding cleanup step: pure-history
 * threads are bulk-resolved (reason `history_import`, `resolvedAt` =
 * `lastMessageAt`), EXCEPT a thread whose most recent message is an inbound
 * customer message within the keep-active window. Threads carrying any live
 * (non-historical) message are never touched, and re-runs are idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { channelInstances } from '@modules/channels/schema'
import { contacts } from '@modules/contacts/schema'
import { eq } from 'drizzle-orm'

import { connectTestDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { conversations, messages } from '../schema'
import {
  __resetConversationsServiceForTests,
  backfillHistoricalMessages,
  createConversationsService,
  installConversationsService,
  resolveImportedHistory,
} from './conversations'
import type { BackfillHistoryInput } from './types'

const ORG = 'org-resolve-history-e2e'
const CONTACT = 'contact-resolve-history-e2e'
const INSTANCE = 'inst-resolve-history-e2e'
// A second instance in the SAME org + a separate org, for scoping isolation.
const INSTANCE_OTHER = 'inst-resolve-history-e2e-other'
const ORG2 = 'org-resolve-history-e2e-2'
const INSTANCE2 = 'inst-resolve-history-e2e-2'
const CONTACT2 = 'contact-resolve-history-e2e-2'

// Fixed clock so the keep-active window (default 7 days) is deterministic.
const NOW = new Date('2026-06-05T00:00:00.000Z')

let handle: TestDbHandle

async function cleanupOrg(org: string): Promise<void> {
  await handle.db.delete(messages).where(eq(messages.organizationId, org))
  await handle.db.delete(conversations).where(eq(conversations.organizationId, org))
  await handle.db.delete(contacts).where(eq(contacts.organizationId, org))
  await handle.db.delete(channelInstances).where(eq(channelInstances.organizationId, org))
}

async function cleanup(): Promise<void> {
  await cleanupOrg(ORG)
  await cleanupOrg(ORG2)
}

/** Backfill one thread on a given (org, instance, contact) and return its conversation id. */
async function seedThreadOn(
  organizationId: string,
  channelInstanceId: string,
  contactId: string,
  threadKey: string,
  msgs: BackfillHistoryInput['messages'],
): Promise<string> {
  const res = await backfillHistoricalMessages({
    organizationId,
    channelInstanceId,
    contactId,
    threadKey,
    messages: msgs,
  })
  return res.conversationId
}

/** Backfill on the primary (ORG, INSTANCE, CONTACT) thread. */
function seedThread(threadKey: string, msgs: BackfillHistoryInput['messages']): Promise<string> {
  return seedThreadOn(ORG, INSTANCE, CONTACT, threadKey, msgs)
}

async function statusOf(id: string): Promise<string | undefined> {
  const [conv] = await handle.db.select().from(conversations).where(eq(conversations.id, id))
  return conv?.status
}

beforeAll(async () => {
  handle = connectTestDb()
  installConversationsService(createConversationsService({ db: handle.db }))
  await cleanup()
  await handle.db
    .insert(channelInstances)
    .values([
      { id: INSTANCE, organizationId: ORG, channel: 'whatsapp', displayName: 'resolve-history-e2e' },
      { id: INSTANCE_OTHER, organizationId: ORG, channel: 'whatsapp', displayName: 'resolve-history-e2e-other' },
      { id: INSTANCE2, organizationId: ORG2, channel: 'whatsapp', displayName: 'resolve-history-e2e-2' },
    ])
    .onConflictDoNothing()
  await handle.db
    .insert(contacts)
    .values([
      { id: CONTACT, organizationId: ORG },
      { id: CONTACT2, organizationId: ORG2 },
    ])
    .onConflictDoNothing()
})

afterAll(async () => {
  await cleanup()
  __resetConversationsServiceForTests()
  await handle.teardown()
})

describe('resolveImportedHistory (e2e)', () => {
  it('resolves dead/handled history threads, keeps a recent unanswered customer thread active, ignores live threads', async () => {
    // 1. Old, business replied last → resolve.
    const oldStaffLast = await seedThread('old-staff-last', [
      {
        wamid: 'r.osl.1',
        content: 'Do you ship?',
        contentType: 'text',
        role: 'customer',
        occurredAt: new Date('2026-01-01T10:00:00Z'),
      },
      {
        wamid: 'r.osl.2',
        content: 'Yes we do!',
        contentType: 'text',
        role: 'staff',
        occurredAt: new Date('2026-03-15T12:30:00Z'),
      },
    ])
    // 2. Old, customer spoke last but long ago (outside window) → resolve.
    const oldCustLast = await seedThread('old-cust-last', [
      {
        wamid: 'r.ocl.1',
        content: 'Still there?',
        contentType: 'text',
        role: 'customer',
        occurredAt: new Date('2026-02-01T09:00:00Z'),
      },
    ])
    // 3. Recent, customer spoke last within window → KEEP active.
    const recentCustLast = await seedThread('recent-cust-last', [
      {
        wamid: 'r.rcl.1',
        content: 'Any update on my order?',
        contentType: 'text',
        role: 'customer',
        occurredAt: new Date('2026-06-03T08:00:00Z'),
      },
    ])
    // 4. Recent, but business replied last → resolve (last message not the customer's).
    const recentStaffLast = await seedThread('recent-staff-last', [
      {
        wamid: 'r.rsl.1',
        content: 'Hello?',
        contentType: 'text',
        role: 'customer',
        occurredAt: new Date('2026-06-01T08:00:00Z'),
      },
      {
        wamid: 'r.rsl.2',
        content: 'Hi — how can I help?',
        contentType: 'text',
        role: 'staff',
        occurredAt: new Date('2026-06-03T09:00:00Z'),
      },
    ])
    // 5. Has a live (non-historical) message → NOT pure history → untouched.
    const halfLive = await seedThread('half-live', [
      {
        wamid: 'r.hl.1',
        content: 'Old imported line',
        contentType: 'text',
        role: 'customer',
        occurredAt: new Date('2026-01-10T08:00:00Z'),
      },
    ])
    await handle.db.insert(messages).values({
      conversationId: halfLive,
      organizationId: ORG,
      role: 'customer',
      kind: 'text',
      content: { text: 'Live message after onboarding' },
      channelExternalId: 'r.hl.live',
      createdAt: new Date('2026-06-04T08:00:00Z'),
      // no metadata.historical — this is a live message
    })

    const summary = await resolveImportedHistory({ organizationId: ORG, channelInstanceId: INSTANCE, now: NOW })

    // 4 pure-history threads scanned; 3 resolved; 1 kept active. half-live excluded.
    expect(summary).toEqual({ scanned: 4, resolved: 3, keptActive: 1 })

    const byId = async (id: string) => (await handle.db.select().from(conversations).where(eq(conversations.id, id)))[0]

    for (const id of [oldStaffLast, oldCustLast, recentStaffLast]) {
      const conv = await byId(id)
      expect(conv?.status).toBe('resolved')
      expect(conv?.resolvedReason).toBe('history_import')
      // resolvedAt reuses the thread's last historical message time.
      expect(conv?.resolvedAt?.toISOString()).toBe(conv?.lastMessageAt?.toISOString())
    }

    const kept = await byId(recentCustLast)
    expect(kept?.status).toBe('active')
    expect(kept?.resolvedReason).toBeNull()

    const live = await byId(halfLive)
    expect(live?.status).toBe('active')
    expect(live?.resolvedReason).toBeNull()
  })

  it('is idempotent — a second run only re-sees the still-active pure-history thread', async () => {
    const summary = await resolveImportedHistory({ organizationId: ORG, channelInstanceId: INSTANCE, now: NOW })
    // Only the kept-active recent-customer thread is still active + pure history.
    expect(summary).toEqual({ scanned: 1, resolved: 0, keptActive: 1 })
  })

  it('only touches the targeted instance + org — leaves other instances and other orgs untouched', async () => {
    // A resolvable (old, business-replied-last) pure-history thread on a SECOND
    // instance in the SAME org.
    const otherInstanceConv = await seedThreadOn(ORG, INSTANCE_OTHER, CONTACT, 'iso-other-instance', [
      {
        wamid: 'iso.oi.1',
        content: 'old',
        contentType: 'text',
        role: 'staff',
        occurredAt: new Date('2026-02-02T08:00:00Z'),
      },
    ])
    // The same, in a DIFFERENT org.
    const otherOrgConv = await seedThreadOn(ORG2, INSTANCE2, CONTACT2, 'iso-other-org', [
      {
        wamid: 'iso.oo.1',
        content: 'old',
        contentType: 'text',
        role: 'staff',
        occurredAt: new Date('2026-02-03T08:00:00Z'),
      },
    ])

    const summary = await resolveImportedHistory({ organizationId: ORG, channelInstanceId: INSTANCE, now: NOW })
    // Scope is (ORG, INSTANCE): neither of the out-of-scope threads is counted...
    expect(summary).toEqual({ scanned: 1, resolved: 0, keptActive: 1 })
    // ...nor resolved.
    expect(await statusOf(otherInstanceConv)).toBe('active')
    expect(await statusOf(otherOrgConv)).toBe('active')
  })
})
