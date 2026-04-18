/**
 * Shared event-sequence assertion helpers — used by Phase 1 and Phase 2 integration tests.
 */
import { expect } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'

export interface AssertEventSequenceOpts {
  ignoreTypes?: string[]
}

export function assertEventSequence(
  events: readonly AgentEvent[],
  expectedTypes: readonly string[],
  opts: AssertEventSequenceOpts = {},
): void {
  const { ignoreTypes = [] } = opts
  const actual = events.map((e) => e.type as string).filter((t) => !ignoreTypes.includes(t))
  expect(actual).toEqual([...expectedTypes])
}

/** Assert that each type in `requiredTypes` appears in order (gaps allowed). */
export function assertEventSubsequence(events: readonly AgentEvent[], requiredTypes: readonly string[]): void {
  const types = events.map((e) => e.type as string)
  let cursor = 0
  for (const req of requiredTypes) {
    const idx = types.indexOf(req, cursor)
    expect(idx >= 0 ? req : `MISSING:${req}`).toBe(req)
    cursor = idx + 1
  }
}
