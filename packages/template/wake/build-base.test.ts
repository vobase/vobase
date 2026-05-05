import { describe, expect, it, mock } from 'bun:test'
import type { HarnessLogger } from '@vobase/core'

import { capStaffIdsForBudgetHeader, STAFF_BUDGET_HEADER_CAP } from './build-base'

function makeLogger(): { logger: HarnessLogger; warn: ReturnType<typeof mock> } {
  const warn = mock(() => {})
  const noop = mock(() => {})
  const logger: HarnessLogger = {
    debug: noop,
    info: noop,
    warn,
    error: noop,
  } as unknown as HarnessLogger
  return { logger, warn }
}

describe('STAFF_BUDGET_HEADER_CAP cap constant', () => {
  it('is 5', () => {
    expect(STAFF_BUDGET_HEADER_CAP).toBe(5)
  })
})

describe('capStaffIdsForBudgetHeader', () => {
  it('empty staffIds no warn — returns [] with no logger.warn call', () => {
    const { logger, warn } = makeLogger()
    const out = capStaffIdsForBudgetHeader([], logger)
    expect(out).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('no cap — pass-through under the cap, no warn', () => {
    const { logger, warn } = makeLogger()
    const ids = ['a', 'b', 'c']
    const out = capStaffIdsForBudgetHeader(ids, logger)
    expect(out).toEqual(ids)
    expect(warn).not.toHaveBeenCalled()
  })

  it('no cap — pass-through at the cap edge, no warn', () => {
    const { logger, warn } = makeLogger()
    const ids = ['a', 'b', 'c', 'd', 'e']
    const out = capStaffIdsForBudgetHeader(ids, logger)
    expect(out).toEqual(ids)
    expect(out.length).toBe(STAFF_BUDGET_HEADER_CAP)
    expect(warn).not.toHaveBeenCalled()
  })

  it('exceeds cap — returns first N ids and emits memory_budget_staff_capped warn', () => {
    const { logger, warn } = makeLogger()
    const ids = Array.from({ length: 30 }, (_, i) => `u_${i}`)
    const out = capStaffIdsForBudgetHeader(ids, logger)
    expect(out.length).toBe(STAFF_BUDGET_HEADER_CAP)
    expect(out).toEqual(ids.slice(0, STAFF_BUDGET_HEADER_CAP))
    expect(warn).toHaveBeenCalledTimes(1)
    const callArgs = warn.mock.calls[0] as [Record<string, unknown>, string]
    expect(callArgs[0]).toMatchObject({
      event: 'memory_budget_staff_capped',
      total: 30,
      cap: STAFF_BUDGET_HEADER_CAP,
    })
  })

  it('exceeds cap — does not mutate the input array', () => {
    const { logger } = makeLogger()
    const ids = Array.from({ length: 10 }, (_, i) => `u_${i}`)
    const before = [...ids]
    capStaffIdsForBudgetHeader(ids, logger)
    expect(ids).toEqual(before)
  })
})
