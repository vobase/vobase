/**
 * Scale e2e for the coexistence history drain against real Postgres. Exercises
 * the hardening that lets a real 180-day burst survive:
 *   - a single chunk with 1,200 messages (forces the backfill INSERT_BATCH loop
 *     and the dedup batching), and
 *   - a 30-chunk queue (forces the drain's bounded-pass loop past CHUNK_BATCH).
 * Each case uses its own org so assertions stay isolated. Non-destructive.
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
  HISTORY_IMPORTED_EVENT,
  HISTORY_RESOLVED_EVENT,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import { conversationEvents } from '@vobase/core'
import { eq } from 'drizzle-orm'

import type { RealtimeService } from '~/runtime'
import { connectTestDb, type TestDbHandle } from '../../../../../tests/helpers/test-db'
import { runWhatsappHistoryDrainJob } from './history-drain'

const ORG_MSG = 'org-drain-burst-msg'
const ORG_CHUNK = 'org-drain-burst-chunk'
const INSTANCE_MSG = 'inst-burst-msg'
const INSTANCE_CHUNK = 'inst-burst-chunk'
const BUSINESS_PHONE = '15550783881'
const PHONE_NUMBER_ID = '106540352242922'
// Far in the past, so the bulk resolve never keeps a thread active on the
// recent-inbound rule (cutoff = now − 7d).
const OLD_TS = 1_700_000_000

const realtimeStub: RealtimeService = { notify: () => {}, subscribe: () => () => {} }

interface BurstThread {
  customerPhone: string
  count: number
}

function buildBurstPayload(opts: {
  phase: number
  chunkOrder: number
  progress: number
  threads: BurstThread[]
}): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'BURST',
        changes: [
          {
            field: 'history',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: PHONE_NUMBER_ID },
              history: [
                {
                  metadata: { phase: opts.phase, chunk_order: opts.chunkOrder, progress: opts.progress },
                  threads: opts.threads.map((t) => ({
                    id: t.customerPhone,
                    messages: Array.from({ length: t.count }, (_, i) => ({
                      from: t.customerPhone, // customer → inbound
                      id: `wamid.${t.customerPhone}.${i}`,
                      timestamp: String(OLD_TS + i),
                      type: 'text',
                      text: { body: `m${i}` },
                      history_context: { status: 'READ' },
                    })),
                  })),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

let handle: TestDbHandle

async function cleanupOrg(org: string): Promise<void> {
  await handle.db.delete(conversationEvents).where(eq(conversationEvents.organizationId, org))
  await handle.db.delete(messages).where(eq(messages.organizationId, org))
  await handle.db.delete(conversations).where(eq(conversations.organizationId, org))
  await handle.db.delete(contacts).where(eq(contacts.organizationId, org))
  await handle.db.delete(whatsappHistoryChunks).where(eq(whatsappHistoryChunks.organizationId, org))
  await handle.db.delete(channelInstances).where(eq(channelInstances.organizationId, org))
}

beforeAll(async () => {
  handle = connectTestDb()
  installChannelInstancesService(createChannelInstancesService({ db: handle.db }))
  installHistoryStagingService(createHistoryStagingService({ db: handle.db }))
  installContactsService(createContactsService({ db: handle.db, realtime: realtimeStub }))
  installConversationsService(createConversationsService({ db: handle.db }))
  await cleanupOrg(ORG_MSG)
  await cleanupOrg(ORG_CHUNK)
  await handle.db
    .insert(channelInstances)
    .values([
      { id: INSTANCE_MSG, organizationId: ORG_MSG, channel: 'whatsapp', displayName: 'burst-msg' },
      { id: INSTANCE_CHUNK, organizationId: ORG_CHUNK, channel: 'whatsapp', displayName: 'burst-chunk' },
    ])
    .onConflictDoNothing()
})

afterAll(async () => {
  await cleanupOrg(ORG_MSG)
  await cleanupOrg(ORG_CHUNK)
  __resetChannelInstancesServiceForTests()
  __resetHistoryStagingServiceForTests()
  __resetContactsServiceForTests()
  __resetConversationsServiceForTests()
  await handle.teardown()
})

describe('runWhatsappHistoryDrainJob — scale (e2e)', () => {
  it('drains a 1,200-message chunk across the insert/dedup batches without loss', async () => {
    const payload = buildBurstPayload({
      phase: 0,
      chunkOrder: 1,
      progress: 100,
      threads: [
        { customerPhone: '16505550001', count: 600 },
        { customerPhone: '16505550002', count: 600 },
      ],
    })
    await stageHistoryChunks([
      {
        organizationId: ORG_MSG,
        channelInstanceId: INSTANCE_MSG,
        phase: 0,
        chunkOrder: 1,
        progress: 100,
        phoneNumberId: PHONE_NUMBER_ID,
        declined: false,
        payload,
      },
    ])

    await runWhatsappHistoryDrainJob({ instanceId: INSTANCE_MSG, organizationId: ORG_MSG })

    const msgs = await handle.db.select().from(messages).where(eq(messages.organizationId, ORG_MSG))
    expect(msgs).toHaveLength(1200)
    expect(msgs.every((m) => (m.metadata as { historical?: boolean }).historical === true)).toBe(true)

    const convs = await handle.db.select().from(conversations).where(eq(conversations.organizationId, ORG_MSG))
    expect(convs).toHaveLength(2)

    // progress=100 + queue drained → import complete → dead (old) threads resolve.
    const [inst] = await handle.db.select().from(channelInstances).where(eq(channelInstances.id, INSTANCE_MSG))
    const ch = (inst?.config as { coexistenceHistory?: { status?: string; progress?: number } }).coexistenceHistory
    expect(ch?.status).toBe('imported')
    expect(ch?.progress).toBe(100)
    expect(convs.every((c) => c.status === 'resolved')).toBe(true)

    // One audit event per conversation (not per message): 2 imported + 2 resolved.
    const events = await handle.db
      .select()
      .from(conversationEvents)
      .where(eq(conversationEvents.organizationId, ORG_MSG))
    expect(events.filter((e) => e.type === HISTORY_IMPORTED_EVENT)).toHaveLength(2)
    expect(events.filter((e) => e.type === HISTORY_RESOLVED_EVENT)).toHaveLength(2)

    // Re-draining is a no-op (wamid idempotency) — no duplicate messages or events.
    await runWhatsappHistoryDrainJob({ instanceId: INSTANCE_MSG, organizationId: ORG_MSG })
    const after = await handle.db.select().from(messages).where(eq(messages.organizationId, ORG_MSG))
    expect(after).toHaveLength(1200)
    const eventsAfter = await handle.db
      .select()
      .from(conversationEvents)
      .where(eq(conversationEvents.organizationId, ORG_MSG))
    expect(eventsAfter.filter((e) => e.type === HISTORY_IMPORTED_EVENT)).toHaveLength(2)
    expect(eventsAfter.filter((e) => e.type === HISTORY_RESOLVED_EVENT)).toHaveLength(2)
  })

  it('drains a 30-chunk queue across multiple bounded passes (CHUNK_BATCH=25)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const order = i + 1
      return {
        organizationId: ORG_CHUNK,
        channelInstanceId: INSTANCE_CHUNK,
        phase: 0,
        chunkOrder: order,
        progress: order === 30 ? 100 : Math.floor((order / 30) * 100),
        phoneNumberId: PHONE_NUMBER_ID,
        declined: false,
        payload: buildBurstPayload({
          phase: 0,
          chunkOrder: order,
          progress: order === 30 ? 100 : Math.floor((order / 30) * 100),
          threads: [{ customerPhone: `1650666${String(order).padStart(4, '0')}`, count: 1 }],
        }),
      }
    })
    await stageHistoryChunks(rows)

    await runWhatsappHistoryDrainJob({ instanceId: INSTANCE_CHUNK, organizationId: ORG_CHUNK })

    const chunkRows = await handle.db
      .select()
      .from(whatsappHistoryChunks)
      .where(eq(whatsappHistoryChunks.organizationId, ORG_CHUNK))
    expect(chunkRows).toHaveLength(30)
    expect(chunkRows.every((c) => c.processedAt !== null)).toBe(true)

    const msgs = await handle.db.select().from(messages).where(eq(messages.organizationId, ORG_CHUNK))
    expect(msgs).toHaveLength(30)

    const [inst] = await handle.db.select().from(channelInstances).where(eq(channelInstances.id, INSTANCE_CHUNK))
    const ch = (inst?.config as { coexistenceHistory?: { status?: string } }).coexistenceHistory
    expect(ch?.status).toBe('imported')
  })
})
