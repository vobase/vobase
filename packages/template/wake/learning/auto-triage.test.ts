import { afterEach, describe, expect, it } from 'bun:test'

import { isAutoTriageEnabled } from './auto-triage'

const ORIGINAL = process.env.LEARN_AUTO_TRIAGE

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LEARN_AUTO_TRIAGE
  else process.env.LEARN_AUTO_TRIAGE = ORIGINAL
})

describe('isAutoTriageEnabled (opt-out kill-switch)', () => {
  it('defaults to enabled when LEARN_AUTO_TRIAGE is unset', () => {
    delete process.env.LEARN_AUTO_TRIAGE
    expect(isAutoTriageEnabled()).toBe(true)
  })

  it('stays enabled for empty / unrecognised / truthy values', () => {
    for (const v of ['', '1', 'true', 'yes', 'on', 'enabled', 'anything']) {
      process.env.LEARN_AUTO_TRIAGE = v
      expect(isAutoTriageEnabled()).toBe(true)
    }
  })

  it('disables only for explicit falsy values (0/false/no/off, case + whitespace insensitive)', () => {
    for (const v of ['0', 'false', 'no', 'off', 'FALSE', 'Off', '  no  ']) {
      process.env.LEARN_AUTO_TRIAGE = v
      expect(isAutoTriageEnabled()).toBe(false)
    }
  })
})
