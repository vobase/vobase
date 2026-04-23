/**
 * Per-turn side-load hash capture — test-only helper for assertion 10.
 *
 * Reads `capturedPrompts` from the harness handle and returns per-turn hashes so
 * the frozen-snapshot invariant can be asserted without inspecting raw strings:
 *   - `systemHash` identical across turns → frozen prompt truly frozen
 *   - `firstUserMessageHash` differs across turns → side-load rebuilt per turn
 *
 * No runtime instrumentation needed; harness.capturedPrompts is already populated
 * by buildSideLoad() inside agent-runner.ts lines 256-307.
 */

import { createHash } from 'node:crypto'
import type { CapturedPrompt } from '@vobase/core'

export function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

export interface TurnHashes {
  turnIndex: number
  /** Hash of `CapturedPrompt.system` — should be IDENTICAL across all turns. */
  systemHash: string
  /** Hash of the full `firstUserMessage` (side-load + trigger message rendered together). */
  firstUserMessageHash: string
}

export function captureSideLoadHashes(capturedPrompts: readonly CapturedPrompt[]): TurnHashes[] {
  return capturedPrompts.map((p, turnIndex) => ({
    turnIndex,
    systemHash: hashString(p.system),
    firstUserMessageHash: hashString(p.firstUserMessage),
  }))
}
