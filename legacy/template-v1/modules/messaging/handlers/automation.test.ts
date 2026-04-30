import { beforeEach, describe, expect, it } from 'bun:test'
import type { PGlite } from '@electric-sql/pglite'
import { errorHandler, type VobaseDb } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { createTestDb } from '../../../lib/test-helpers'
import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
  automationRules,
  broadcastRecipients,
  broadcasts,
  channelInstances,
  contacts,
} from '../schema'
import { automationHandlers } from './automation'
import { contactsHandlers } from './contacts'

let _pglite: PGlite
let db: VobaseDb

function buildApp(testDb: VobaseDb): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('db', testDb)
    c.set('user', {
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test',
      role: 'admin',
    })
    await next()
  })
  app.route('/automation', automationHandlers)
  app.route('/contacts', contactsHandlers)
  return app
}

let app: Hono

const CHANNEL_ID = 'auto-ci'

beforeEach(async () => {
  const result = await createTestDb({ withAutomation: true })
  _pglite = result.pglite as unknown as PGlite
  db = result.db
  app = buildApp(db)

  await db.insert(channelInstances).values({
    id: CHANNEL_ID,
    type: 'whatsapp',
    label: 'WA',
    source: 'env',
    status: 'active',
  })
})

async function createRule(overrides?: object) {
  const res = await app.request('/automation/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Rule',
      type: 'recurring',
      channelInstanceId: CHANNEL_ID,
      schedule: '0 9 * * 1',
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
  return res.json() as Promise<{ id: string; isActive: boolean; type: string }>
}

// ─── Pause / Resume ────────────────────────────────────────────────

describe('pause/resume idempotence', () => {
  it('pause sets isActive=false, pause again is idempotent', async () => {
    const rule = await createRule()

    const res1 = await app.request(`/automation/rules/${rule.id}/pause`, {
      method: 'POST',
    })
    expect(res1.status).toBe(200)
    expect(await res1.json()).toEqual({ ok: true })

    const [row1] = await db
      .select({ isActive: automationRules.isActive })
      .from(automationRules)
      .where(eq(automationRules.id, rule.id))
    expect(row1.isActive).toBe(false)

    // Second pause — idempotent
    const res2 = await app.request(`/automation/rules/${rule.id}/pause`, {
      method: 'POST',
    })
    expect(res2.status).toBe(200)
    const [row2] = await db
      .select({ isActive: automationRules.isActive })
      .from(automationRules)
      .where(eq(automationRules.id, rule.id))
    expect(row2.isActive).toBe(false)
  })

  it('resume sets isActive=true, resume again is idempotent', async () => {
    const rule = await createRule()

    // Pause first
    await app.request(`/automation/rules/${rule.id}/pause`, { method: 'POST' })

    const res1 = await app.request(`/automation/rules/${rule.id}/resume`, {
      method: 'POST',
    })
    expect(res1.status).toBe(200)
    expect(await res1.json()).toEqual({ ok: true })

    const [row1] = await db
      .select({ isActive: automationRules.isActive })
      .from(automationRules)
      .where(eq(automationRules.id, rule.id))
    expect(row1.isActive).toBe(true)

    // Second resume — idempotent
    const res2 = await app.request(`/automation/rules/${rule.id}/resume`, {
      method: 'POST',
    })
    expect(res2.status).toBe(200)
    const [row2] = await db
      .select({ isActive: automationRules.isActive })
      .from(automationRules)
      .where(eq(automationRules.id, rule.id))
    expect(row2.isActive).toBe(true)
  })

  it('resume clears nextFireAt for recurring rules', async () => {
    const rule = await createRule({ type: 'recurring', schedule: '0 9 * * 1' })

    // Manually set nextFireAt
    await db
      .update(automationRules)
      .set({ nextFireAt: new Date('2025-01-01T09:00:00Z') })
      .where(eq(automationRules.id, rule.id))

    await app.request(`/automation/rules/${rule.id}/pause`, { method: 'POST' })
    await app.request(`/automation/rules/${rule.id}/resume`, {
      method: 'POST',
    })

    const [row] = await db
      .select({ nextFireAt: automationRules.nextFireAt })
      .from(automationRules)
      .where(eq(automationRules.id, rule.id))
    expect(row.nextFireAt).toBeNull()
  })
})

// ─── Parameter Validation ──────────────────────────────────────────

describe('parameter validation against ParameterSchema', () => {
  it('POST /rules stores parameterSchema and validates on PATCH', async () => {
    const res = await app.request('/automation/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Param Rule',
        type: 'recurring',
        channelInstanceId: CHANNEL_ID,
        parameterSchema: {
          delay: { type: 'number', label: 'Delay (hours)', min: 1, max: 72 },
          mode: {
            type: 'select',
            label: 'Mode',
            options: [
              { value: 'fast', label: 'Fast' },
              { value: 'slow', label: 'Slow' },
            ],
          },
        },
        parameters: { delay: 24, mode: 'fast' },
      }),
    })
    expect(res.status).toBe(201)
    const rule = (await res.json()) as { id: string }

    // Valid parameter update
    const patchOk = await app.request(`/automation/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: { delay: 48, mode: 'slow' } }),
    })
    expect(patchOk.status).toBe(200)

    // Number below min
    const patchBelowMin = await app.request(`/automation/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: { delay: 0 } }),
    })
    expect(patchBelowMin.status).toBe(400)

    // Number above max
    const patchAboveMax = await app.request(`/automation/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: { delay: 100 } }),
    })
    expect(patchAboveMax.status).toBe(400)

    // Unknown key
    const patchUnknown = await app.request(`/automation/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: { unknownKey: 'value' } }),
    })
    expect(patchUnknown.status).toBe(400)
  })
})

// ─── Audience Preview ─────────────────────────────────────────────

describe('audience-preview count correctness', () => {
  it('returns count matching stored audienceFilter', async () => {
    // Seed contacts: 2 customers with phone, 1 opted-out
    await db.insert(contacts).values([
      { id: 'c1', phone: '+6511111111', role: 'customer' },
      { id: 'c2', phone: '+6522222222', role: 'customer' },
      {
        id: 'c3',
        phone: '+6533333333',
        role: 'customer',
        marketingOptOut: true,
      },
    ])

    const rule = await createRule({
      audienceFilter: { roles: ['customer'], excludeOptedOut: true },
    })

    const res = await app.request(`/automation/rules/${rule.id}/audience-preview`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      count: number
      samples: unknown[]
    }
    // c1 and c2 match; c3 is opted-out
    expect(body.count).toBe(2)
    expect(body.samples.length).toBeLessThanOrEqual(5)
  })
})

// ─── Step Replacement ─────────────────────────────────────────────

describe('step replacement transaction', () => {
  it('replaces all steps atomically', async () => {
    const rule = await createRule({
      steps: [
        {
          sequence: 1,
          templateId: 'tmpl-1',
          templateName: 'Hello',
          isFinal: false,
        },
      ],
    })

    const res = await app.request(`/automation/rules/${rule.id}/steps`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [
          {
            sequence: 1,
            templateId: 'tmpl-2',
            templateName: 'Step 1',
            isFinal: false,
          },
          {
            sequence: 2,
            templateId: 'tmpl-3',
            templateName: 'Step 2',
            delayHours: 24,
            isFinal: true,
          },
        ],
      }),
    })
    expect(res.status).toBe(200)

    const steps = await db
      .select()
      .from(automationRuleSteps)
      .where(eq(automationRuleSteps.ruleId, rule.id))
      .orderBy(automationRuleSteps.sequence)

    expect(steps.length).toBe(2)
    expect(steps[0].templateId).toBe('tmpl-2')
    expect(steps[1].templateId).toBe('tmpl-3')
    expect(steps[1].isFinal).toBe(true)
  })

  it('rejects steps with invalid sendAtTime format', async () => {
    const rule = await createRule()

    const res = await app.request(`/automation/rules/${rule.id}/steps`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [
          {
            sequence: 1,
            templateId: 'tmpl-1',
            templateName: 'Step',
            sendAtTime: '25:00', // invalid
          },
        ],
      }),
    })
    expect(res.status).toBe(400)
  })
})

// ─── Simulate (read-only dry-run) ────────────────────────────────

describe('simulate dry-run', () => {
  it('returns audience count and timeline without writing any rows', async () => {
    await db.insert(contacts).values([
      { id: 'sim-c1', phone: '+6511111111', role: 'customer' },
      { id: 'sim-c2', phone: '+6522222222', role: 'customer' },
    ])

    const rule = await createRule({
      audienceFilter: { roles: ['customer'], excludeOptedOut: true },
      steps: [
        {
          sequence: 1,
          templateId: 'tmpl-a',
          templateName: 'Welcome',
          sendAtTime: '09:00',
          isFinal: false,
        },
        {
          sequence: 2,
          templateId: 'tmpl-b',
          templateName: 'Follow-up',
          delayHours: 24,
          isFinal: true,
        },
      ],
    })

    const res = await app.request(`/automation/rules/${rule.id}/simulate`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      audienceCount: number
      samples: unknown[]
      timeline: Array<{
        sequence: number
        isReplyGated: boolean
        isFinal: boolean
        templateName: string
      }>
    }

    expect(body.audienceCount).toBe(2)
    expect(body.timeline).toHaveLength(2)
    expect(body.timeline[0].isReplyGated).toBe(false)
    expect(body.timeline[1].isReplyGated).toBe(true)
    expect(body.timeline[1].isFinal).toBe(true)

    // Confirm zero writes
    const recipients = await db.select().from(automationRecipients)
    const executions = await db.select().from(automationExecutions)
    expect(recipients.length).toBe(0)
    expect(executions.length).toBe(0)
  })
})

// ─── Contact Delete FK Protection ────────────────────────────────

describe('contact-delete FK protection', () => {
  it('deletes contact with automation recipients inside a single transaction', async () => {
    await db.insert(contacts).values({
      id: 'contact-del',
      phone: '+6599000000',
      role: 'customer',
    })

    // Create rule → execution → recipient
    const [rule] = await db
      .insert(automationRules)
      .values({
        name: 'Del Rule',
        type: 'recurring',
        channelInstanceId: CHANNEL_ID,
        audienceFilter: {},
        parameters: {},
        parameterSchema: {},
        timezone: 'UTC',
        createdBy: 'test-user',
      })
      .returning()

    const [execution] = await db
      .insert(automationExecutions)
      .values({
        ruleId: rule.id,
        stepSequence: 1,
        status: 'running',
      })
      .returning()

    await db.insert(automationRecipients).values({
      executionId: execution.id,
      ruleId: rule.id,
      contactId: 'contact-del',
      phone: '+6599000000',
      variables: {},
      status: 'queued',
    })

    // Also add a broadcast recipient to verify broadcast cleanup still works
    const [broadcast] = await db
      .insert(broadcasts)
      .values({
        name: 'B',
        channelInstanceId: CHANNEL_ID,
        templateId: 'tmpl',
        templateName: 'T',
        templateLanguage: 'en',
        status: 'draft',
        createdBy: 'test-user',
      })
      .returning()

    await db.insert(broadcastRecipients).values({
      broadcastId: broadcast.id,
      contactId: 'contact-del',
      phone: '+6599000000',
      variables: {},
    })

    // Delete contact — should succeed with the transaction wrapping all FK deps
    const res = await app.request('/contacts/contact-del', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Verify automation recipients are gone
    const remaining = await db
      .select()
      .from(automationRecipients)
      .where(eq(automationRecipients.contactId, 'contact-del'))
    expect(remaining.length).toBe(0)

    // Verify broadcast recipients are gone
    const bremaining = await db
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.contactId, 'contact-del'))
    expect(bremaining.length).toBe(0)
  })
})
