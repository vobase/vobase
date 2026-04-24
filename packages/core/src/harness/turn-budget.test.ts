import { describe, expect, it } from 'bun:test'

import { L3_CEILING_BYTES, TurnBudget } from './turn-budget'

describe('TurnBudget', () => {
  it('starts empty — isExceeded/wouldExceed false', () => {
    const b = new TurnBudget()
    expect(b.isExceeded()).toBe(false)
    expect(b.wouldExceed(0)).toBe(false)
    expect(b.wouldExceed(L3_CEILING_BYTES)).toBe(false)
    expect(b.wouldExceed(L3_CEILING_BYTES + 1)).toBe(true)
  })

  it('record() accumulates across calls', () => {
    const b = new TurnBudget()
    b.record(10_000)
    b.record(20_000)
    expect(b.wouldExceed(L3_CEILING_BYTES - 30_000)).toBe(false)
    expect(b.wouldExceed(L3_CEILING_BYTES - 30_000 + 1)).toBe(true)
  })

  it('isExceeded fires strictly past the ceiling, not at it', () => {
    const b = new TurnBudget()
    b.record(L3_CEILING_BYTES)
    expect(b.isExceeded()).toBe(false)
    b.record(1)
    expect(b.isExceeded()).toBe(true)
  })

  it('reset() zeroes consumed bytes', () => {
    const b = new TurnBudget()
    b.record(L3_CEILING_BYTES + 100)
    expect(b.isExceeded()).toBe(true)
    b.reset()
    expect(b.isExceeded()).toBe(false)
    expect(b.wouldExceed(L3_CEILING_BYTES)).toBe(false)
  })
})
