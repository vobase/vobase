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
import { CUSTOMER_CHANNEL_INSTANCE_ID } from '@modules/contacts/seed'
import { createContactsService, installContactsService } from '@modules/contacts/service/contacts'
import { messages } from '@modules/messaging/schema'
import { createConversationsService, installConversationsService } from '@modules/messaging/service/conversations'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import { createReactionsService, installReactionsService } from '@modules/messaging/service/reactions'
import { createSessionsService, installSessionsService } from '@modules/messaging/service/sessions'
import type { MessageReceivedEvent } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { getSeededOrgId } from '../../../../tests/helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../../tests/helpers/test-db'
import { dispatchInbound } from '../../service/inbound'
import { __resetForTests as __resetRegistryForTests, register as registerAdapter } from '../../service/registry'
import { createChannelsState, installChannelsState, type JobQueue } from '../../service/state'
import { WHATSAPP_CAPABILITIES, WHATSAPP_CHANNEL_NAME } from './factory'

let db: TestDbHandle

const sentJobs: Array<{ name: string; data: unknown }> = []
const stubJobs: JobQueue = {
  // biome-ignore lint/suspicious/useAwait: JobQueue contract requires async signature
  send: async (name: string, data: unknown) => {
    sentJobs.push({ name, data })
    return 'stub-job-id'
  },
}

let INSTANCE: ChannelInstance

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

let organizationId: string

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  organizationId = await getSeededOrgId(db.db)
  INSTANCE = {
    id: CUSTOMER_CHANNEL_INSTANCE_ID,
    organizationId,
    channel: 'whatsapp',
    displayName: 'Test WA',
    config: {},
    platformChannelId: null,
    role: 'customer',
    webhookSecret: null,
    status: null,
    setupStage: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  installContactsService(
    createContactsService({ db: db.db, realtime: { notify: () => {}, subscribe: () => () => {} } }),
  )
  installConversationsService(createConversationsService({ db: db.db }))
  installMessagesService(createMessagesService({ db: db.db }))
  installSessionsService(createSessionsService({ db: db.db }))
  installReactionsService(createReactionsService({ db: db.db }))
  installChannelsState(createChannelsState({ jobs: stubJobs }))
  // Register a minimal stub — the dispatcher only reads `contactIdentifierField`
  // and `capabilities.messagingWindow` here; the real adapter would demand
  // Meta creds we don't want to thread through this test.
  __resetRegistryForTests()
  registerAdapter(
    WHATSAPP_CHANNEL_NAME,
    () =>
      ({
        name: WHATSAPP_CHANNEL_NAME,
        inboundMode: 'push',
        contactIdentifierField: 'phone',
        capabilities: WHATSAPP_CAPABILITIES,
        send: async () => ({ success: true }),
      }) as never,
    WHATSAPP_CAPABILITIES,
  )
}, 60_000)

afterAll(async () => {
  __resetRegistryForTests()
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

  it('echo event enqueues coexistence_echo triage signal when conversation assigned to an agent', async () => {
    sentJobs.length = 0
    const echoMsgId = `echo-triage-${Date.now()}`
    // Use a unique phone number so this creates a fresh conversation with the agent assignee.
    const uniquePhone = `whatsapp:+6570001${Date.now() % 10000}`

    await dispatchInbound(
      [
        makeMessageEvent({
          messageId: echoMsgId,
          from: uniquePhone,
          content: 'Staff reply via WA Business App',
          metadata: { echo: true, echoSource: 'business_app', direction: 'outbound' },
        }),
      ],
      INSTANCE,
      { defaultAssignee: 'agent:test-bot-1' },
    )

    // fire-and-forget — flush microtasks
    await new Promise((r) => setTimeout(r, 10))

    const triageJobs = sentJobs.filter((j) => j.name === 'learning:triage')
    expect(triageJobs).toHaveLength(1)
    const payload = triageJobs[0]?.data as Record<string, unknown>
    expect((payload?.signal as Record<string, unknown>)?.kind).toBe('coexistence_echo')
    expect(payload?.agentId).toBe('test-bot-1')
  })

  it('echo event does NOT enqueue coexistence_echo triage when conversation is unassigned', async () => {
    sentJobs.length = 0
    const echoMsgId = `echo-notriage-${Date.now()}`
    // Use a unique phone number to ensure a fresh conversation with no agent assignee.
    const uniquePhone = `whatsapp:+6570002${Date.now() % 10000}`

    await dispatchInbound(
      [
        makeMessageEvent({
          messageId: echoMsgId,
          from: uniquePhone,
          metadata: { echo: true, echoSource: 'business_app', direction: 'outbound' },
        }),
      ],
      INSTANCE,
      { defaultAssignee: null },
    )

    await new Promise((r) => setTimeout(r, 10))

    const triageJobs = sentJobs.filter((j) => j.name === 'learning:triage')
    expect(triageJobs).toHaveLength(0)
  })
})
