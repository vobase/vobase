/**
 * Frozen-snapshot assertion: every turn of a single wake must observe the
 * same system prompt hash AND the same set of materializer paths. The
 * provider's prefix cache is byte-keyed, and the agent must not race its own
 * writes — divergence between turns means the cache is being invalidated and
 * the wake's behaviour is undefined.
 *
 * `assertFrozenForWake()` is invoked at the start of every turn after the
 * first. On mismatch it journals a `frozen_snapshot_violation` event AND
 * throws so the wake aborts.
 */

import { append } from './journal'
import type { FrozenSnapshotViolationEvent } from './types'

export interface FrozenSnapshot {
  systemHash: string
  /** Sorted, distinct list of materializer paths visible in the frozen prompt. */
  materializerSet: readonly string[]
}

export class FrozenSnapshotViolationError extends Error {
  readonly expected: FrozenSnapshot
  readonly actual: FrozenSnapshot
  constructor(expected: FrozenSnapshot, actual: FrozenSnapshot) {
    super(buildMessage(expected, actual))
    this.expected = expected
    this.actual = actual
  }
}

function buildMessage(expected: FrozenSnapshot, actual: FrozenSnapshot): string {
  const lines = ['frozen_snapshot_violation:']
  if (expected.systemHash !== actual.systemHash) {
    lines.push(`  systemHash: expected ${expected.systemHash} actual ${actual.systemHash}`)
  }
  const expectedSet = new Set(expected.materializerSet)
  const actualSet = new Set(actual.materializerSet)
  const missing = [...expectedSet].filter((p) => !actualSet.has(p))
  const extra = [...actualSet].filter((p) => !expectedSet.has(p))
  if (missing.length) lines.push(`  materializers missing: ${missing.join(', ')}`)
  if (extra.length) lines.push(`  materializers added: ${extra.join(', ')}`)
  return lines.join('\n')
}

export interface AssertFrozenInput {
  organizationId: string
  conversationId: string
  wakeId: string
  turnIndex: number
  expected: FrozenSnapshot
  actual: FrozenSnapshot
  now?: () => Date
}

/**
 * Throws `FrozenSnapshotViolationError` and journals a
 * `frozen_snapshot_violation` event when `expected` and `actual` disagree.
 * Otherwise, no-op.
 */
export async function assertFrozenForWake(input: AssertFrozenInput): Promise<void> {
  const { expected, actual } = input
  const expectedSet = new Set(expected.materializerSet)
  const actualSet = new Set(actual.materializerSet)
  const sameHash = expected.systemHash === actual.systemHash
  const sameSize = expectedSet.size === actualSet.size
  const sameSet = sameSize && [...expectedSet].every((p) => actualSet.has(p))
  if (sameHash && sameSet) return

  const event: FrozenSnapshotViolationEvent = {
    type: 'frozen_snapshot_violation',
    ts: (input.now ?? (() => new Date()))(),
    wakeId: input.wakeId,
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    turnIndex: input.turnIndex,
    expectedSystemHash: expected.systemHash,
    actualSystemHash: actual.systemHash,
    expectedMaterializerSet: [...expectedSet].sort(),
    actualMaterializerSet: [...actualSet].sort(),
  }
  await append({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    wakeId: input.wakeId,
    turnIndex: input.turnIndex,
    event,
  })

  throw new FrozenSnapshotViolationError(expected, actual)
}

/**
 * Build a `FrozenSnapshot` from a system hash + an iterable of materializer
 * paths. Sorts and de-dupes so callers don't need to.
 */
export function buildFrozenSnapshot(systemHash: string, paths: Iterable<string>): FrozenSnapshot {
  const set = new Set<string>()
  for (const p of paths) set.add(p)
  return { systemHash, materializerSet: [...set].sort() }
}
