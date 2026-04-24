import { beforeEach, describe, expect, it } from 'bun:test'
import type { ChannelsService, RealtimeService, Scheduler, VobaseDb } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../../lib/test-helpers'
import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
  automationRules,
  channelInstances,
  contacts,
} from '../schema'
import { evaluateDateRelativeRules } from './automation-engine'
import { rescheduleDateRelativeRecipients } from './automation-reschedule'
import { setModuleDeps } from './deps'

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

const CI_ID = 'rs-ci'

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
})

// ─── Helpers ──────────────────────────────────────────────────────

async function seedDateRelativeRule(overrides: {
  dateAttribute: string
  offsetDays: number
}): Promise<{ ruleId: string; stepId: string }> {
  const [rule] = await db
    .insert(automationRules)
    .values({
      name: 'Reschedule Test Rule',
      type: 'date-relative',
      isActive: true,
      channelInstanceId: CI_ID,
      dateAttribute: overrides.dateAttribute,
      audienceFilter: {},
      parameters: {},
      parameterSchema: {},
      timezone: 'UTC',
      createdBy: 'system',
    })
    .returning()

  const [step] = await db
    .insert(automationRuleSteps)
    .values({
      ruleId: rule.id,
      sequence: 1,
      offsetDays: overrides.offsetDays,
      templateId: 'tmpl',
      templateName: 'T',
      templateLanguage: 'en',
      variableMapping: {},
    })
    .returning()

  return { ruleId: rule.id, stepId: step.id }
}

async function seedQueuedRecipient(opts: {
  ruleId: string
  contactId: string
  phone: string
  dateValue: string
}): Promise<{ executionId: string; recipientId: string }> {
  const [execution] = await db
    .insert(automationExecutions)
    .values({ ruleId: opts.ruleId, stepSequence: 1, status: 'running' })
    .returning()

  const [recipient] = await db
    .insert(automationRecipients)
    .values({
      executionId: execution.id,
      ruleId: opts.ruleId,
      contactId: opts.contactId,
      phone: opts.phone,
      variables: {},
      currentStep: 1,
      status: 'queued',
      dateValue: opts.dateValue,
    } as never)
    .returning()

  return { executionId: execution.id, recipientId: recipient.id }
}

// ─── Tests ────────────────────────────────────────────────────────

describe('rescheduleDateRelativeRecipients', () => {
  it('cancels stale queued recipient when contact date attribute changes', async () => {
    // offsetDays=-7 means fire 7 days before event
    // dateValue='2026-04-17', expected contact date = 2026-04-17 + 7 = 2026-04-24
    const { ruleId } = await seedDateRelativeRule({
      dateAttribute: 'appointment_date',
      offsetDays: -7,
    })

    const [contact] = await db
      .insert(contacts)
      .values({
        id: 'rs-contact-1',
        phone: '+6591000001',
        role: 'customer',
        attributes: { appointment_date: '2026-04-24' }, // matches dateValue=2026-04-17 with offset=-7
      })
      .returning()

    const { recipientId } = await seedQueuedRecipient({
      ruleId,
      contactId: contact.id,
      phone: contact.phone ?? '',
      dateValue: '2026-04-17',
    })

    // Change contact's appointment to a different date
    await db
      .update(contacts)
      .set({ attributes: { appointment_date: '2026-04-30' } })
      .where(eq(contacts.id, contact.id))

    const result = await rescheduleDateRelativeRecipients()
    expect(result.cancelled).toBe(1)

    const [r] = await db
      .select({
        status: automationRecipients.status,
        failureReason: automationRecipients.failureReason,
      })
      .from(automationRecipients)
      .where(eq(automationRecipients.id, recipientId))
    expect(r.status).toBe('skipped')
    expect(r.failureReason).toBe('date_changed')
  })

  it('does not cancel recipient when contact date matches stored dateValue', async () => {
    const { ruleId } = await seedDateRelativeRule({
      dateAttribute: 'event_date',
      offsetDays: -2,
    })

    // offsetDays=-2, dateValue='2026-04-17' → expected event_date = 2026-04-19
    const [contact] = await db
      .insert(contacts)
      .values({
        id: 'rs-contact-2',
        phone: '+6591000002',
        role: 'customer',
        attributes: { event_date: '2026-04-19' },
      })
      .returning()

    const { recipientId } = await seedQueuedRecipient({
      ruleId,
      contactId: contact.id,
      phone: contact.phone ?? '',
      dateValue: '2026-04-17',
    })

    const result = await rescheduleDateRelativeRecipients()
    expect(result.cancelled).toBe(0)

    const [r] = await db
      .select({ status: automationRecipients.status })
      .from(automationRecipients)
      .where(eq(automationRecipients.id, recipientId))
    expect(r.status).toBe('queued')
  })

  it('re-evaluate creates new recipient after cancellation without duplicating', async () => {
    // offsetDays=-7: fire 7 days before event. Event originally Apr 24, fires Apr 17.
    const { ruleId } = await seedDateRelativeRule({
      dateAttribute: 'appointment_date',
      offsetDays: -7,
    })

    const [contact] = await db
      .insert(contacts)
      .values({
        id: 'rs-contact-3',
        phone: '+6591000003',
        role: 'customer',
        attributes: { appointment_date: '2026-04-24' },
      })
      .returning()

    // Seed existing queued recipient for old date
    await seedQueuedRecipient({
      ruleId,
      contactId: contact.id,
      phone: contact.phone ?? '',
      dateValue: '2026-04-17',
    })

    // Contact reschedules to Apr 30 → fire on Apr 23
    await db
      .update(contacts)
      .set({ attributes: { appointment_date: '2026-04-30' } })
      .where(eq(contacts.id, contact.id))

    // Reschedule tick cancels stale recipient
    const { cancelled } = await rescheduleDateRelativeRecipients()
    expect(cancelled).toBe(1)

    // Evaluate on Apr 23 (7 days before Apr 30) → creates new recipient
    const now = new Date('2026-04-23T11:00:00Z')
    const { recipientsInserted } = await evaluateDateRelativeRules(now)
    expect(recipientsInserted).toBe(1)

    // Only one active (queued) recipient — no duplicate
    const all = await db
      .select({
        status: automationRecipients.status,
        dateValue: automationRecipients.dateValue,
      })
      .from(automationRecipients)
      .where(eq(automationRecipients.ruleId, ruleId))

    const active = all.filter((r) => r.status !== 'skipped')
    expect(active).toHaveLength(1)
    expect(active[0].dateValue).toBe('2026-04-23')
  })
})
