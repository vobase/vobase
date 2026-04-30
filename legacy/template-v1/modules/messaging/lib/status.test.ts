import { beforeEach, describe, expect, it } from 'bun:test'
import type { ChannelsService, RealtimeService, Scheduler, VobaseDb } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../../lib/test-helpers'
import {
  automationExecutions,
  automationRecipients,
  automationRules,
  broadcastRecipients,
  broadcasts,
  channelInstances,
  contacts,
  conversations,
  messages,
} from '../schema'
import { setModuleDeps } from './deps'
import { handleStatusUpdate } from './status'

// ─── Mock infrastructure ──────────────────────────────────────────

const mockRealtime: RealtimeService = { notify: async () => {} } as never
const mockScheduler = {
  async add() {
    return { id: 'job-1' }
  },
  async send() {
    return null
  },
  async schedule() {},
  async unschedule() {},
  async stop() {},
} as unknown as Scheduler
const mockChannels = {
  email: { send: async () => ({ success: true, messageId: 'e-1' }) },
  whatsapp: { send: async () => ({ success: true, messageId: 'w-1' }) },
  on() {},
  get() {
    return undefined
  },
  getAdapter() {
    return undefined
  },
  registerAdapter() {},
  unregisterAdapter() {},
  onProvision() {},
  async provision() {
    throw new Error('not implemented')
  },
} as unknown as ChannelsService

let db: VobaseDb

const CI_ID = 'st-ci'

beforeEach(async () => {
  const result = await createTestDb({ withAutomation: true })
  db = result.db
  setModuleDeps({
    db,
    scheduler: mockScheduler,
    channels: mockChannels,
    realtime: mockRealtime,
  })

  await db.insert(channelInstances).values({
    id: CI_ID,
    type: 'whatsapp',
    label: 'WA',
    source: 'env',
  })

  await db.insert(contacts).values({
    id: 'st-contact',
    phone: '+6591000001',
    role: 'customer',
  })
})

// ─── Layer 1: messages table ──────────────────────────────────────

describe('Layer 1 — messages table', () => {
  it('updates message status when externalMessageId matches', async () => {
    // Seed minimal conversation + message
    await db.insert(conversations).values({
      id: 'conv-st1',
      contactId: 'st-contact',
      agentId: 'agent',
      channelInstanceId: CI_ID,
      assignee: 'agent',
      status: 'active',
    } as never)

    await db.insert(messages).values({
      id: 'msg-st1',
      conversationId: 'conv-st1',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Hi',
      senderId: 'user',
      senderType: 'user',
      externalMessageId: 'ext-layer1',
      status: 'sent',
    })

    await handleStatusUpdate({
      type: 'status_update',
      messageId: 'ext-layer1',
      status: 'delivered',
      channel: 'whatsapp',
      timestamp: Date.now(),
    })

    const [msg] = await db.select({ status: messages.status }).from(messages).where(eq(messages.id, 'msg-st1'))
    expect(msg.status).toBe('delivered')
  })
})

// ─── Layer 2: broadcastRecipients fallback ────────────────────────

describe('Layer 2 — broadcastRecipients fallback', () => {
  it('updates broadcast recipient and increments deliveredCount when no message matches', async () => {
    const [broadcast] = await db
      .insert(broadcasts)
      .values({
        name: 'Status Test Broadcast',
        channelInstanceId: CI_ID,
        templateId: 'tmpl',
        templateName: 'T',
        templateLanguage: 'en',
        status: 'sending',
        createdBy: 'system',
        sentCount: 1,
      })
      .returning()

    await db.insert(broadcastRecipients).values({
      broadcastId: broadcast.id,
      contactId: 'st-contact',
      phone: '+6591000001',
      variables: {},
      status: 'sent',
      externalMessageId: 'ext-layer2',
    } as never)

    await handleStatusUpdate({
      type: 'status_update',
      messageId: 'ext-layer2',
      status: 'delivered',
      channel: 'whatsapp',
      timestamp: Date.now(),
    })

    const [br] = await db
      .select({ status: broadcastRecipients.status })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.externalMessageId, 'ext-layer2'))
    expect(br.status).toBe('delivered')

    const [b] = await db
      .select({ deliveredCount: broadcasts.deliveredCount })
      .from(broadcasts)
      .where(eq(broadcasts.id, broadcast.id))
    expect(b.deliveredCount).toBe(1)
  })
})

// ─── Layer 3: automationRecipients fallback ───────────────────────

describe('Layer 3 — automationRecipients fallback', () => {
  async function seedExecution() {
    const [rule] = await db
      .insert(automationRules)
      .values({
        name: 'Status Rule',
        type: 'recurring',
        channelInstanceId: CI_ID,
        audienceFilter: {},
        parameters: {},
        parameterSchema: {},
        timezone: 'UTC',
        createdBy: 'system',
      })
      .returning()

    const [execution] = await db
      .insert(automationExecutions)
      .values({ ruleId: rule.id, stepSequence: 1, status: 'running' })
      .returning()

    return { rule, execution }
  }

  it('updates automation recipient when no message or broadcast matches', async () => {
    const { execution } = await seedExecution()

    await db.insert(automationRecipients).values({
      executionId: execution.id,
      ruleId: execution.ruleId,
      contactId: 'st-contact',
      phone: '+6591000002',
      variables: {},
      status: 'sent',
      externalMessageId: 'ext-layer3',
    } as never)

    await handleStatusUpdate({
      type: 'status_update',
      messageId: 'ext-layer3',
      status: 'delivered',
      channel: 'whatsapp',
      timestamp: Date.now(),
    })

    const [ar] = await db
      .select({ status: automationRecipients.status })
      .from(automationRecipients)
      .where(eq(automationRecipients.externalMessageId, 'ext-layer3'))
    expect(ar.status).toBe('delivered')

    const [ae] = await db
      .select({ deliveredCount: automationExecutions.deliveredCount })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, execution.id))
    expect(ae.deliveredCount).toBe(1)
  })

  it('increments both readCount and deliveredCount when skipping sent→read', async () => {
    const { execution } = await seedExecution()

    await db.insert(automationRecipients).values({
      executionId: execution.id,
      ruleId: execution.ruleId,
      contactId: 'st-contact',
      phone: '+6591000003',
      variables: {},
      status: 'sent',
      externalMessageId: 'ext-layer3-read',
    } as never)

    await handleStatusUpdate({
      type: 'status_update',
      messageId: 'ext-layer3-read',
      status: 'read',
      channel: 'whatsapp',
      timestamp: Date.now(),
    })

    const [ae] = await db
      .select({
        readCount: automationExecutions.readCount,
        deliveredCount: automationExecutions.deliveredCount,
      })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, execution.id))
    expect(ae.readCount).toBe(1)
    expect(ae.deliveredCount).toBe(1) // skipped delivered → also incremented
  })

  it('Layer 1 wins over Layer 3 when same externalMessageId exists in both', async () => {
    const { execution } = await seedExecution()

    // Insert message with same external ID
    await db.insert(conversations).values({
      id: 'conv-st-l1win',
      contactId: 'st-contact',
      agentId: 'agent',
      channelInstanceId: CI_ID,
      assignee: 'agent',
      status: 'active',
    } as never)

    await db.insert(messages).values({
      id: 'msg-l1win',
      conversationId: 'conv-st-l1win',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Hi',
      senderId: 'user',
      senderType: 'user',
      externalMessageId: 'ext-l1-wins',
      status: 'sent',
    })

    await db.insert(automationRecipients).values({
      executionId: execution.id,
      ruleId: execution.ruleId,
      contactId: 'st-contact',
      phone: '+6591000004',
      variables: {},
      status: 'sent',
      externalMessageId: 'ext-l1-wins',
    } as never)

    await handleStatusUpdate({
      type: 'status_update',
      messageId: 'ext-l1-wins',
      status: 'delivered',
      channel: 'whatsapp',
      timestamp: Date.now(),
    })

    // Message updated
    const [msg] = await db.select({ status: messages.status }).from(messages).where(eq(messages.id, 'msg-l1win'))
    expect(msg.status).toBe('delivered')

    // Automation execution counters untouched (Layer 1 won)
    const [ae] = await db
      .select({ deliveredCount: automationExecutions.deliveredCount })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, execution.id))
    expect(ae.deliveredCount).toBe(0)
  })
})
