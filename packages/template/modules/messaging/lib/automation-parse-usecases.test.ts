import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { VobaseDb } from '@vobase/core'

import { createTestDb } from '../../../lib/test-helpers'
import { DraftRuleSchema } from './automation-parse-schema'
import { ParameterSchema } from './parameter-schema'

// ─── Mock setup ────────────────────────────────────────────────────
// Prevent real LLM calls; force hasLlmCredentials() to return true.
process.env.OPENAI_API_KEY = 'test-key-for-usecase-tests'

interface GenerateObjectArgs {
  prompt: string
}

// ─── Use-case draft fixtures ────────────────────────────────────────

const RESTAURANT_DRAFT = {
  name: 'Weekly Tuesday lunch promo',
  type: 'recurring' as const,
  schedule: '0 11 * * 2',
  timezone: 'Asia/Singapore',
  audienceFilter: { excludeOptedOut: true },
  steps: [
    {
      sequence: 1,
      templateSuggestion: 'lunch_promo_weekly',
      variableMapping: { '1': 'name' },
      isFinal: true,
    },
  ],
  parameters: { spendThreshold: 'medium', promoName: 'Tuesday lunch' },
  parameterSchema: {
    spendThreshold: { type: 'number' as const, label: 'Spend threshold' },
    promoName: { type: 'string' as const, label: 'Promo name' },
  },
}

const CATERING_DRAFT = {
  name: 'Event reminder — 7 days before',
  type: 'date-relative' as const,
  dateAttribute: 'event_date',
  timezone: 'Asia/Singapore',
  audienceFilter: { excludeOptedOut: true },
  steps: [
    {
      sequence: 1,
      offsetDays: -7,
      sendAtTime: '09:00',
      templateSuggestion: 'event_reminder_7d',
      variableMapping: { '1': 'name', '2': 'attributes.event_date' },
      isFinal: true,
    },
  ],
  parameters: { offsetDays: -7, sendAtTime: '09:00' },
  parameterSchema: {
    offsetDays: {
      type: 'number' as const,
      label: 'Days before event',
      default: -7,
    },
    sendAtTime: { type: 'time' as const, label: 'Send time', default: '09:00' },
  },
}

const CLINIC_DRAFT = {
  name: 'Botox pre-treatment reminder',
  type: 'date-relative' as const,
  dateAttribute: 'appointment_date',
  timezone: 'Asia/Singapore',
  audienceFilter: { excludeOptedOut: true },
  steps: [
    {
      sequence: 1,
      offsetDays: -2,
      sendAtTime: '09:00',
      templateSuggestion: 'pre_treatment_reminder_botox',
      variableMapping: { '1': 'name', '2': 'attributes.appointment_date' },
      isFinal: false,
    },
    {
      sequence: 2,
      delayHours: 24,
      templateSuggestion: 'pre_treatment_chaser_botox',
      variableMapping: { '1': 'name' },
      isFinal: false,
    },
  ],
  parameters: { offsetDays: -2, sendAtTime: '09:00', chaserDelayHours: 24 },
  parameterSchema: {
    offsetDays: {
      type: 'number' as const,
      label: 'Days before appointment',
      default: -2,
    },
    sendAtTime: { type: 'time' as const, label: 'Send time', default: '09:00' },
    chaserDelayHours: {
      type: 'number' as const,
      label: 'Chaser delay (hours)',
      default: 24,
      min: 1,
    },
  },
}

function pickDraft(userPrompt: string) {
  const p = userPrompt.toLowerCase()
  if (p.includes('lunch') || p.includes('restaurant')) return RESTAURANT_DRAFT
  if (p.includes('event reminder') || p.includes('catering')) return CATERING_DRAFT
  if (p.includes('botox') || p.includes('pre-treatment')) return CLINIC_DRAFT
  throw new Error(`unexpected test prompt: ${userPrompt}`)
}

const originalAi = await import('ai')
mock.module('ai', () => ({
  ...originalAi,
  generateObject: async (args: GenerateObjectArgs) => {
    return { object: pickDraft(args.prompt) }
  },
}))

const originalProvider = await import('../../agents/mastra/lib/provider')
mock.module('../../agents/mastra/lib/provider', () => ({
  ...originalProvider,
  getChatModel: (_modelId: string) => ({ __mock: 'chat-model' }),
}))

// Dynamic import AFTER mocks are registered
const { parseRuleFromPrompt } = await import('./automation-parse')

// ─── Acceptance tests ───────────────────────────────────────────────

describe('use-case acceptance — restaurant', () => {
  let db: VobaseDb

  beforeEach(async () => {
    ;({ db } = await createTestDb({ withAutomation: true }))
  })

  it('produces valid DraftRule + ParameterSchema', async () => {
    const draft = await parseRuleFromPrompt(
      'Send a weekly Tuesday 11am lunch promo to lunch_crowd contacts with spend_tier of medium or higher',
      { db },
    )

    expect(DraftRuleSchema.safeParse(draft).success).toBe(true)
    expect(ParameterSchema.safeParse(draft.parameterSchema).success).toBe(true)
  })

  it('type is recurring', async () => {
    const draft = await parseRuleFromPrompt(
      'Send a weekly Tuesday 11am lunch promo to lunch_crowd contacts with spend_tier of medium or higher',
      { db },
    )
    expect(draft.type).toBe('recurring')
  })

  it('schedule is valid cron expression for Tuesday 11am', async () => {
    const draft = await parseRuleFromPrompt(
      'Send a weekly Tuesday 11am lunch promo to lunch_crowd contacts with spend_tier of medium or higher',
      { db },
    )
    expect(draft.schedule).toBe('0 11 * * 2')
  })

  it('has exactly one step', async () => {
    const draft = await parseRuleFromPrompt(
      'Send a weekly Tuesday 11am lunch promo to lunch_crowd contacts with spend_tier of medium or higher',
      { db },
    )
    expect(draft.steps).toHaveLength(1)
  })

  it('parameterSchema has spendThreshold (number) and promoName (string)', async () => {
    const draft = await parseRuleFromPrompt(
      'Send a weekly Tuesday 11am lunch promo to lunch_crowd contacts with spend_tier of medium or higher',
      { db },
    )
    const schema = draft.parameterSchema ?? {}
    expect(schema).toHaveProperty('spendThreshold')
    expect(schema).toHaveProperty('promoName')
    expect((schema as Record<string, { type: string }>).spendThreshold?.type).toBe('number')
    expect((schema as Record<string, { type: string }>).promoName?.type).toBe('string')
  })
})

describe('use-case acceptance — catering', () => {
  let db: VobaseDb

  beforeEach(async () => {
    ;({ db } = await createTestDb({ withAutomation: true }))
  })

  it('produces valid DraftRule + ParameterSchema', async () => {
    const draft = await parseRuleFromPrompt('Send event reminder 7 days before each customer event_date at 9am', { db })
    expect(DraftRuleSchema.safeParse(draft).success).toBe(true)
    expect(ParameterSchema.safeParse(draft.parameterSchema).success).toBe(true)
  })

  it('type is date-relative with event_date attribute', async () => {
    const draft = await parseRuleFromPrompt('Send event reminder 7 days before each customer event_date at 9am', { db })
    expect(draft.type).toBe('date-relative')
    expect(draft.dateAttribute).toBe('event_date')
  })

  it('step[0] has offsetDays=-7 and sendAtTime=09:00', async () => {
    const draft = await parseRuleFromPrompt('Send event reminder 7 days before each customer event_date at 9am', { db })
    expect(draft.steps[0]?.offsetDays).toBe(-7)
    expect(draft.steps[0]?.sendAtTime).toBe('09:00')
  })

  it('parameterSchema has offsetDays (number) and sendAtTime (time)', async () => {
    const draft = await parseRuleFromPrompt('Send event reminder 7 days before each customer event_date at 9am', { db })
    const schema = draft.parameterSchema ?? {}
    expect(schema).toHaveProperty('offsetDays')
    expect(schema).toHaveProperty('sendAtTime')
    expect((schema as Record<string, { type: string }>).offsetDays?.type).toBe('number')
    expect((schema as Record<string, { type: string }>).sendAtTime?.type).toBe('time')
  })
})

describe('use-case acceptance — clinic', () => {
  let db: VobaseDb

  beforeEach(async () => {
    ;({ db } = await createTestDb({ withAutomation: true }))
  })

  it('produces valid DraftRule + ParameterSchema', async () => {
    const draft = await parseRuleFromPrompt(
      'Pre-treatment reminder 2 days before botox appointments at 9am, with 24-hour chaser if no reply',
      { db },
    )
    expect(DraftRuleSchema.safeParse(draft).success).toBe(true)
    expect(ParameterSchema.safeParse(draft.parameterSchema).success).toBe(true)
  })

  it('type is date-relative with appointment_date attribute', async () => {
    const draft = await parseRuleFromPrompt(
      'Pre-treatment reminder 2 days before botox appointments at 9am, with 24-hour chaser if no reply',
      { db },
    )
    expect(draft.type).toBe('date-relative')
    expect(draft.dateAttribute).toBe('appointment_date')
  })

  it('has two steps', async () => {
    const draft = await parseRuleFromPrompt(
      'Pre-treatment reminder 2 days before botox appointments at 9am, with 24-hour chaser if no reply',
      { db },
    )
    expect(draft.steps).toHaveLength(2)
  })

  it('step[1] has delayHours=24 and isFinal=false', async () => {
    const draft = await parseRuleFromPrompt(
      'Pre-treatment reminder 2 days before botox appointments at 9am, with 24-hour chaser if no reply',
      { db },
    )
    expect(draft.steps[1]?.delayHours).toBe(24)
    expect(draft.steps[1]?.isFinal).toBe(false)
  })
})
