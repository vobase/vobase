/**
 * Learning-flow event-sequence assertion helpers — used by Phase 3 dogfood test.
 * Reuses the subset-matcher from assert-event-sequence.ts.
 */
import { expect } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import { assertEventSubsequence } from './assert-event-sequence'

export type LearningEventType = 'learning_proposed' | 'learning_approved' | 'learning_rejected'

export interface LearningFlowOpts {
  /** Ordered event types that must appear in sequence (gaps allowed). */
  expectedChain: LearningEventType[]
  /** If set, assert at least one learning_proposed has this scope. */
  scope?: string
}

/** Assert learning events appear in order; optionally assert scope. */
export function assertLearningFlow(events: readonly AgentEvent[], opts: LearningFlowOpts): void {
  const learning = captureLearningEvents(events)
  assertEventSubsequence(learning, opts.expectedChain)
  if (opts.scope) {
    const match = learning.find((e) => e.type === 'learning_proposed' && (e as { scope?: string }).scope === opts.scope)
    expect(match, `assertLearningFlow: no learning_proposed with scope=${opts.scope}`).toBeTruthy()
  }
}

/** Extract only learning_proposed / approved / rejected events from a wake stream. */
export function captureLearningEvents(events: readonly AgentEvent[]): Array<AgentEvent & { type: LearningEventType }> {
  return events.filter(
    (e): e is AgentEvent & { type: LearningEventType } =>
      e.type === 'learning_proposed' || e.type === 'learning_approved' || e.type === 'learning_rejected',
  )
}
