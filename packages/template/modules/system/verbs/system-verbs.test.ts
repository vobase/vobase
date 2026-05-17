/**
 * Schema + audience tests for the three system-module verbs.
 *
 * These don't call the body — that would require a Postgres handle. The
 * service-layer tests in `modules/automations/service/{automations,budget-caps}.test.ts`
 * already cover the underlying mutations. This file asserts the verb
 * contract: name, audience, input schema accepts the documented shapes.
 */

import { describe, expect, it } from 'bun:test'

import { automationsPauseVerb } from './automations-pause'
import { automationsResumeVerb } from './automations-resume'
import { budgetSetVerb } from './budget-set'

describe('automations:pause verb', () => {
  it('has name "automations:pause"', () => {
    expect(automationsPauseVerb.name).toBe('automations:pause')
  })

  it('is staff-audience (admin + staff can pause, contact cannot)', () => {
    expect(automationsPauseVerb.audience).toBe('staff')
  })

  it('accepts ruleId + reason', () => {
    const r = automationsPauseVerb.inputSchema.safeParse({ ruleId: 'r1', reason: 'manual' })
    expect(r.success).toBe(true)
  })

  it('rejects empty ruleId', () => {
    const r = automationsPauseVerb.inputSchema.safeParse({ ruleId: '', reason: 'manual' })
    expect(r.success).toBe(false)
  })

  it('rejects missing reason', () => {
    const r = automationsPauseVerb.inputSchema.safeParse({ ruleId: 'r1' })
    expect(r.success).toBe(false)
  })
})

describe('automations:resume verb', () => {
  it('has name "automations:resume"', () => {
    expect(automationsResumeVerb.name).toBe('automations:resume')
  })

  it('is staff-audience', () => {
    expect(automationsResumeVerb.audience).toBe('staff')
  })

  it('accepts ruleId', () => {
    const r = automationsResumeVerb.inputSchema.safeParse({ ruleId: 'r1' })
    expect(r.success).toBe(true)
  })

  it('rejects empty ruleId', () => {
    const r = automationsResumeVerb.inputSchema.safeParse({ ruleId: '' })
    expect(r.success).toBe(false)
  })
})

describe('budget:set verb', () => {
  it('has name "budget:set"', () => {
    expect(budgetSetVerb.name).toBe('budget:set')
  })

  it('is staff-audience', () => {
    expect(budgetSetVerb.audience).toBe('staff')
  })

  it('accepts a positive capUsd value', () => {
    const r = budgetSetVerb.inputSchema.safeParse({ capUsd: 5 })
    expect(r.success).toBe(true)
  })

  it('accepts capUsd === 0 (effectively disables agent spend without removing the row)', () => {
    const r = budgetSetVerb.inputSchema.safeParse({ capUsd: 0 })
    expect(r.success).toBe(true)
  })

  it('accepts --clear=true', () => {
    const r = budgetSetVerb.inputSchema.safeParse({ clear: true })
    expect(r.success).toBe(true)
  })

  it('rejects negative capUsd', () => {
    const r = budgetSetVerb.inputSchema.safeParse({ capUsd: -1 })
    expect(r.success).toBe(false)
  })

  it('rejects empty input (need either capUsd or clear)', () => {
    const r = budgetSetVerb.inputSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})
