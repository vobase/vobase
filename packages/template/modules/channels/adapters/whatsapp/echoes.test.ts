/**
 * Integration tests for smb_message_echoes dispatch path.
 *
 * Coverage:
 *   - Echo event → message persisted with role='staff', metadata.echo=true
 *   - Echo event → wake job NOT enqueued
 *   - Customer event → wake job IS enqueued
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ChannelInstance } from '@modules/channels/schema'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_ORG_ID } from '@modules/contacts/seed'
import { messages } from '@modules/messaging/schema'
import { createConversationsService, installConversationsService } from '@modules/messaging/service/conversations'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import { createReactionsService, installReactionsService } from '@modules/messaging/service/reactions'
import { createSessionsService, installSessionsService } from '@modules/messaging/service/sessions'
import type { MessageReceivedEvent } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../../tests/helpers/test-db'
import { dispatchInbound } from '../../service/inbound'
import { createChannelsState, installChannelsState, type JobQueue } from '../../service/state'

let db: TestDbHandle

const sentJobs: Array<{ name: string; data: unknown }> = []
const stubJobs: JobQueue = {
  send: async (name: string, data: unknown) => {
    sentJobs.push({ name, data })
    return 'stub-job-id'
  },
}

const INSTANCE: ChannelInstance = {
  id: CUSTOMER_CHANNEL_INSTANCE_ID,
  organizationId: MERIDIAN_ORG_ID,
  channel: 'whatsapp',
  displayName: 'Test WA',
  config: {},
  role: 'customer',
  webhookSecret: null,
  status: null,
  setupStage: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeMessageEvent(overrides: Partial<MessageReceivedEvent> & { messageId: string }): MessageReceivedEvent {
  return {
    type: 'message_received',
    channel: 'whatsapp',
    from: `whatsapp:+6591234567`,
    content: 'Test message',
    messageType: 'text',
    profileName: 'Tester',
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  }
}

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()

  installConversationsService(createConversationsService({ db: db.db }))
  installMessagesService(createMessagesService({ db: db.db }))
  installSessionsService(createSessionsService({ db: db.db }))
  installReactionsService(createReactionsService({ db: db.db }))
  installChannelsState(createChannelsState({ jobs: stubJobs }))
}, 60_000)

afterAll(async () => {
  if (db) await db.teardown()
})

describe('smb_message_echoes dispatch path', () => {
  it('echo event persists message with role=staff and metadata.echo=true', async () => {
    sentJobs.length = 0
    const echoMsgId = `echo-test-${Date.now()}`

    await dispatchInbound(
      [
        makeMessageEvent({
          messageId: echoMsgId,
          content: 'Hello from WA Business App',
          metadata: { echo: true, echoSource: 'business_app', direction: 'outbound' },
        }),
      ],
      INSTANCE,
      { defaultAssignee: null },
    )

    const dbHandle = db.db as unknown as {
      select: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
    }
    const rows = await dbHandle.select().from(messages).where(eq(messages.channelExternalId, echoMsgId)).limit(1)

    const msg = rows[0] as { role: string; metadata: Record<string, unknown> } | undefined
    expect(msg).toBeDefined()
    expect(msg?.role).toBe('staff')
    expect(msg?.metadata?.echo).toBe(true)
  })

  it('echo event does NOT enqueue a wake job', async () => {
    sentJobs.length = 0
    const echoMsgId = `echo-nowake-${Date.now()}`

    await dispatchInbound(
      [
        makeMessageEvent({
          messageId: echoMsgId,
          metadata: { echo: true, echoSource: 'business_app', direction: 'outbound' },
        }),
      ],
      INSTANCE,
    )

    const wakeJobs = sentJobs.filter((j) => j.name === 'agents:wake')
    expect(wakeJobs).toHaveLength(0)
  })

  it('customer message DOES enqueue a wake job', async () => {
    sentJobs.length = 0
    const custMsgId = `customer-wake-${Date.now()}`

    await dispatchInbound(
      [
        makeMessageEvent({
          messageId: custMsgId,
          from: 'whatsapp:+6599999001',
          metadata: {},
        }),
      ],
      INSTANCE,
      { defaultAssignee: null },
    )

    const wakeJobs = sentJobs.filter((j) => j.name === 'agents:wake')
    expect(wakeJobs.length).toBeGreaterThanOrEqual(1)
  })
})
