/**
 * Webhook ingress dispatch test — regression guard for the
 * `webhook.ts:43` bug where `defaultAssignee` was dropped on WhatsApp inbound.
 *
 * Coverage:
 *   - When `instance.config.defaultAssignee` is set, `dispatchInbound` is
 *     called with that assignee and the resulting conversation row carries it.
 *   - When unset, the conversation lands at `'unassigned'` (no regression
 *     for greenfield channels that haven't picked an assignee yet).
 *
 * Skipped (not failed) when Docker Postgres is unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ChannelInstance } from '@modules/channels/schema'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_ORG_ID } from '@modules/contacts/seed'
import { createContactsService, installContactsService } from '@modules/contacts/service/contacts'
import { conversations } from '@modules/messaging/schema'
import { createConversationsService, installConversationsService } from '@modules/messaging/service/conversations'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import { createReactionsService, installReactionsService } from '@modules/messaging/service/reactions'
import { createSessionsService, installSessionsService } from '@modules/messaging/service/sessions'
import { createNoopRealtime, type MessageReceivedEvent } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { WHATSAPP_CAPABILITIES, WHATSAPP_CHANNEL_NAME } from '../adapters/whatsapp/factory'
import { dispatchInbound } from '../service/inbound'
import { __resetForTests as __resetRegistryForTests, register as registerAdapter } from '../service/registry'
import { createChannelsState, installChannelsState, type JobQueue } from '../service/state'

let db: TestDbHandle

const sentJobs: Array<{ name: string; data: unknown }> = []
const stubJobs: JobQueue = {
  send: async (name: string, data: unknown) => {
    sentJobs.push({ name, data })
    return 'stub-job-id'
  },
}

function makeInstance(config: Record<string, unknown>): ChannelInstance {
  return {
    id: CUSTOMER_CHANNEL_INSTANCE_ID,
    organizationId: MERIDIAN_ORG_ID,
    channel: 'whatsapp',
    displayName: 'WA routing test',
    config,
    platformChannelId: null,
    role: 'customer',
    webhookSecret: null,
    status: null,
    setupStage: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeMessageEvent(messageId: string, from: string): MessageReceivedEvent {
  return {
    type: 'message_received',
    channel: 'whatsapp',
    from,
    content: 'hello',
    messageType: 'text',
    profileName: 'Tester',
    timestamp: Date.now(),
    metadata: {},
    messageId,
  }
}

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()

  installContactsService(createContactsService({ db: db.db, realtime: createNoopRealtime() }))
  installConversationsService(createConversationsService({ db: db.db }))
  installMessagesService(createMessagesService({ db: db.db }))
  installSessionsService(createSessionsService({ db: db.db }))
  installReactionsService(createReactionsService({ db: db.db }))
  installChannelsState(createChannelsState({ jobs: stubJobs }))
  __resetRegistryForTests()
  registerAdapter(
    WHATSAPP_CHANNEL_NAME,
    () =>
      ({
        name: WHATSAPP_CHANNEL_NAME,
        inboundMode: 'push',
        contactIdentifierField: 'phone',
        capabilities: WHATSAPP_CAPABILITIES,
        // biome-ignore lint/suspicious/useAwait: contract requires async signature
        send: async () => ({ success: true }),
      }) as never,
    WHATSAPP_CAPABILITIES,
  )
}, 60_000)

afterAll(async () => {
  __resetRegistryForTests()
  if (db) await db.teardown()
})

describe('webhook → dispatchInbound defaultAssignee plumbing', () => {
  it('respects config.defaultAssignee on inbound', async () => {
    const msgId = `route-with-assignee-${Date.now()}`
    const instance = makeInstance({ defaultAssignee: 'agent:routing-test-agent' })

    // The webhook handler reads `instance.config.defaultAssignee` and forwards
    // it as `opts.defaultAssignee`. We mirror that call here so the test
    // pins the contract that produced the bug fix at webhook.ts:43.
    const defaultAssignee = (instance.config as { defaultAssignee?: string | null }).defaultAssignee ?? null
    const results = await dispatchInbound([makeMessageEvent(msgId, `whatsapp:+6588776655`)], instance, {
      defaultAssignee,
    })

    expect(results).toHaveLength(1)
    const first = results[0]
    expect(first).toBeDefined()
    if (!first) throw new Error('unreachable')

    const dbHandle = db.db as unknown as {
      select: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
    }
    const rows = await dbHandle.select().from(conversations).where(eq(conversations.id, first.conversationId)).limit(1)
    const row = rows[0] as { assignee: string } | undefined
    expect(row?.assignee).toBe('agent:routing-test-agent')
  })

  it('falls through to "unassigned" when defaultAssignee unset', async () => {
    const msgId = `route-no-assignee-${Date.now()}`
    const instance = makeInstance({}) // no defaultAssignee

    const defaultAssignee = (instance.config as { defaultAssignee?: string | null }).defaultAssignee ?? null
    const results = await dispatchInbound([makeMessageEvent(msgId, `whatsapp:+6588776656`)], instance, {
      defaultAssignee,
    })

    const first = results[0]
    expect(first).toBeDefined()
    if (!first) throw new Error('unreachable')
    const dbHandle = db.db as unknown as {
      select: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
    }
    const rows = await dbHandle.select().from(conversations).where(eq(conversations.id, first.conversationId)).limit(1)
    const row = rows[0] as { assignee: string } | undefined
    expect(row?.assignee).toBe('unassigned')
  })
})
