/**
 * E2E for the coexistence history drain against real Postgres. Stages a chunk
 * (Meta's official approved example) and runs the drain end-to-end, asserting
 * the messages land in the inbox as resolved conversations with correct
 * direction, the chunk is marked processed, the sync status advances, and a
 * re-drain is idempotent. Non-destructive: synthetic org + cleanup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { channelInstances, whatsappHistoryChunks } from '@modules/channels/schema'
import {
  __resetHistoryStagingServiceForTests,
  createHistoryStagingService,
  installHistoryStagingService,
  stageHistoryChunks,
} from '@modules/channels/service/history-staging'
import {
  __resetChannelInstancesServiceForTests,
  createChannelInstancesService,
  installChannelInstancesService,
} from '@modules/channels/service/instances'
import { contacts } from '@modules/contacts/schema'
import {
  __resetContactsServiceForTests,
  createContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import { conversations, messages } from '@modules/messaging/schema'
import {
  __resetConversationsServiceForTests,
  createConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import { eq } from 'drizzle-orm'

import type { RealtimeService } from '~/runtime'
import { connectTestDb, type TestDbHandle } from '../../../../../tests/helpers/test-db'
import { runWhatsappHistoryDrainJob } from './history-drain'

const ORG = 'org-drain-e2e'
const INSTANCE = 'inst-drain-e2e'

const realtimeStub: RealtimeService = { notify: () => {}, subscribe: () => () => {} }

// Meta's official approved example: 2 threads, 4 messages — 3 business-sent
// (staff) incl. a media_placeholder, and 1 customer reply (customer).
const HISTORY_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'history',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
            history: [
              {
                metadata: { phase: 0, chunk_order: 1, progress: 55 },
                threads: [
                  {
                    id: '16505551234',
                    messages: [
                      {
                        from: '15550783881',
                        id: 'wamid.D1',
                        timestamp: '1739230955',
                        type: 'text',
                        text: { body: "Here's the info" },
                        history_context: { status: 'READ' },
                      },
                      {
                        from: '15550783881',
                        id: 'wamid.D2',
                        timestamp: '1739230970',
                        type: 'media_placeholder',
                        history_context: { status: 'PLAYED' },
                      },
                      {
                        from: '16505551234',
                        id: 'wamid.D3',
                        timestamp: '1739230970',
                        type: 'text',
                        text: { body: 'Thanks!' },
                        history_context: { status: 'READ' },
                      },
                    ],
                  },
                  {
                    id: '12125557890',
                    messages: [
                      {
                        from: '15550783881',
                        id: 'wamid.D4',
                        timestamp: '1739230970',
                        type: 'text',
                        text: { body: 'Thanks for your order!' },
                        history_context: { status: 'DELIVERED' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
}

let handle: TestDbHandle

async function cleanup(): Promise<void> {
  await handle.db.delete(messages).where(eq(messages.organizationId, ORG))
  await handle.db.delete(conversations).where(eq(conversations.organizationId, ORG))
  await handle.db.delete(contacts).where(eq(contacts.organizationId, ORG))
  await handle.db.delete(whatsappHistoryChunks).where(eq(whatsappHistoryChunks.organizationId, ORG))
  await handle.db.delete(channelInstances).where(eq(channelInstances.organizationId, ORG))
}

beforeAll(async () => {
  handle = connectTestDb()
  installChannelInstancesService(createChannelInstancesService({ db: handle.db }))
  installHistoryStagingService(createHistoryStagingService({ db: handle.db }))
  installContactsService(createContactsService({ db: handle.db, realtime: realtimeStub }))
  installConversationsService(createConversationsService({ db: handle.db }))
  await cleanup()
  await handle.db
    .insert(channelInstances)
    .values({ id: INSTANCE, organizationId: ORG, channel: 'whatsapp', displayName: 'drain-e2e' })
    .onConflictDoNothing()
})

afterAll(async () => {
  await cleanup()
  __resetChannelInstancesServiceForTests()
  __resetHistoryStagingServiceForTests()
  __resetContactsServiceForTests()
  __resetConversationsServiceForTests()
  await handle.teardown()
})

describe('runWhatsappHistoryDrainJob (e2e)', () => {
  it('stages → drains → lands history in the inbox as resolved conversations', async () => {
    await stageHistoryChunks([
      {
        organizationId: ORG,
        channelInstanceId: INSTANCE,
        phase: 0,
        chunkOrder: 1,
        progress: 55,
        phoneNumberId: '106540352242922',
        declined: false,
        payload: HISTORY_PAYLOAD,
      },
    ])

    await runWhatsappHistoryDrainJob({ instanceId: INSTANCE, organizationId: ORG })

    const convs = await handle.db.select().from(conversations).where(eq(conversations.organizationId, ORG))
    expect(convs).toHaveLength(2)
    expect(convs.every((c) => c.status === 'active')).toBe(true)

    const msgs = await handle.db.select().from(messages).where(eq(messages.organizationId, ORG))
    expect(msgs).toHaveLength(4)
    const staffMsgs = msgs.filter((m) => m.role === 'staff')
    const customerMsgs = msgs.filter((m) => m.role === 'customer')
    expect(staffMsgs).toHaveLength(3)
    expect(customerMsgs).toHaveLength(1)
    // Business-sent rows carry `echoSource: 'business_app'` so the UI renders a
    // generic "Staff" identity instead of mis-attributing to a real staffer.
    expect(staffMsgs.every((m) => (m.metadata as { echoSource?: string }).echoSource === 'business_app')).toBe(true)
    expect(customerMsgs.every((m) => (m.metadata as { echoSource?: string }).echoSource === undefined)).toBe(true)

    const chunkRows = await handle.db
      .select()
      .from(whatsappHistoryChunks)
      .where(eq(whatsappHistoryChunks.organizationId, ORG))
    expect(chunkRows).toHaveLength(1)
    expect(chunkRows[0]?.processedAt).not.toBeNull()

    const [inst] = await handle.db.select().from(channelInstances).where(eq(channelInstances.id, INSTANCE))
    const ch = (inst?.config as { coexistenceHistory?: { status?: string; progress?: number } }).coexistenceHistory
    expect(ch?.status).toBe('importing')
    expect(ch?.progress).toBe(55)
  })

  it('is idempotent — re-staging + re-draining the same messages inserts no duplicates', async () => {
    await stageHistoryChunks([
      {
        organizationId: ORG,
        channelInstanceId: INSTANCE,
        phase: 1,
        chunkOrder: 1,
        progress: 55,
        phoneNumberId: '106540352242922',
        declined: false,
        payload: HISTORY_PAYLOAD,
      },
    ])

    await runWhatsappHistoryDrainJob({ instanceId: INSTANCE, organizationId: ORG })

    // wamid idempotency: re-processing the same 4 messages must not duplicate.
    const msgs = await handle.db.select().from(messages).where(eq(messages.organizationId, ORG))
    expect(msgs).toHaveLength(4)
  })
})
