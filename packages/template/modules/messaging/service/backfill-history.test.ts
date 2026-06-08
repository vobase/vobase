/**
 * E2E for `backfillHistoricalMessages` against real Postgres (no DB mocks, per
 * the repo convention). Uses a unique synthetic org id + cleans up its own rows
 * so the surrounding dev DB is left untouched (no nuke/reseed).
 *
 * Asserts the external behaviour: an active+unassigned conversation, real
 * historical `createdAt` ordering, correct role/direction mapping,
 * `lastMessageAt` = latest message, and wamid-idempotent replay.
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
} from './conversations'
import type { BackfillHistoryInput } from './types'

const ORG = 'org-backfill-e2e'
const CONTACT = 'contact-backfill-e2e'
const INSTANCE = 'inst-backfill-e2e'

let handle: TestDbHandle

async function cleanup(): Promise<void> {
  // FK-safe order: messages → conversations → (contact, channel_instance).
  await handle.db.delete(messages).where(eq(messages.organizationId, ORG))
  await handle.db.delete(conversations).where(eq(conversations.organizationId, ORG))
  await handle.db.delete(contacts).where(eq(contacts.organizationId, ORG))
  await handle.db.delete(channelInstances).where(eq(channelInstances.organizationId, ORG))
}

beforeAll(async () => {
  handle = connectTestDb()
  installConversationsService(createConversationsService({ db: handle.db }))
  await cleanup()
  // Seed the FK parents the backfill conversation requires (in production the
  // drain upserts the contact and the channel instance exists from onboarding).
  await handle.db
    .insert(channelInstances)
    .values({ id: INSTANCE, organizationId: ORG, channel: 'whatsapp', displayName: 'backfill-e2e' })
    .onConflictDoNothing()
  await handle.db.insert(contacts).values({ id: CONTACT, organizationId: ORG }).onConflictDoNothing()
})

afterAll(async () => {
  await cleanup()
  __resetConversationsServiceForTests()
  await handle.teardown()
})

const T1 = new Date('2026-01-01T10:00:00.000Z')
const T2 = new Date('2026-03-15T12:30:00.000Z')

const input: BackfillHistoryInput = {
  organizationId: ORG,
  channelInstanceId: INSTANCE,
  contactId: CONTACT,
  messages: [
    {
      wamid: 'wamid.A',
      content: 'Hi, do you have any availability this week?',
      contentType: 'text',
      role: 'customer',
      occurredAt: T1,
    },
    { wamid: 'wamid.B', content: 'Yes! Several options.', contentType: 'text', role: 'staff', occurredAt: T2 },
  ],
}

describe('backfillHistoricalMessages (e2e)', () => {
  it('creates a resolved conversation and writes messages with real timestamps + roles', async () => {
    const res = await backfillHistoricalMessages(input)
    expect(res.inserted).toBe(2)
    expect(res.skipped).toBe(0)

    const [conv] = await handle.db.select().from(conversations).where(eq(conversations.id, res.conversationId))
    expect(conv?.status).toBe('active')
    expect(conv?.assignee).toBe('unassigned')
    expect(conv?.lastMessageAt?.toISOString()).toBe(T2.toISOString())

    const rows = await handle.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, res.conversationId))
      .orderBy(messages.createdAt)
    expect(rows.map((m) => m.channelExternalId)).toEqual(['wamid.A', 'wamid.B'])
    expect(rows.map((m) => m.role)).toEqual(['customer', 'staff'])
    expect(rows[0]?.createdAt.toISOString()).toBe(T1.toISOString())
    expect(rows[1]?.createdAt.toISOString()).toBe(T2.toISOString())
  })

  it('is idempotent on wamid — a replay inserts nothing and reports them skipped', async () => {
    const res = await backfillHistoricalMessages(input)
    expect(res.inserted).toBe(0)
    expect(res.skipped).toBe(2)

    const rows = await handle.db.select().from(messages).where(eq(messages.conversationId, res.conversationId))
    expect(rows).toHaveLength(2)
  })

  it('reuses the same conversation and only inserts the new message on a later partial backfill', async () => {
    const T3 = new Date('2026-04-01T09:00:00.000Z')
    const res = await backfillHistoricalMessages({
      ...input,
      messages: [
        ...input.messages,
        { wamid: 'wamid.C', content: 'Thanks!', contentType: 'text', role: 'customer', occurredAt: T3 },
      ],
    })
    expect(res.inserted).toBe(1)
    expect(res.skipped).toBe(2)

    const [conv] = await handle.db.select().from(conversations).where(eq(conversations.id, res.conversationId))
    expect(conv?.lastMessageAt?.toISOString()).toBe(T3.toISOString())
  })
})
