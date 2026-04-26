import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { assertFrozenForWake, buildFrozenSnapshot, FrozenSnapshotViolationError } from './frozen-snapshot'
import { __resetJournalServiceForTests, installJournalService } from './journal'

let journals: Array<{ type: string; event: Record<string, unknown> }>

beforeEach(() => {
  __resetJournalServiceForTests()
  journals = []
  installJournalService({
    append: (input) => {
      const ev = input.event as Record<string, unknown>
      journals.push({ type: ev.type as string, event: ev })
      return Promise.resolve()
    },
    getLastWakeTail: () => Promise.resolve({ interrupted: false }),
    getLatestTurnIndex: () => Promise.resolve(0),
  })
})

afterEach(() => {
  __resetJournalServiceForTests()
})

const base = {
  organizationId: 'o1',
  conversationId: 'c1',
  wakeId: 'w1',
  turnIndex: 1,
}

describe('buildFrozenSnapshot', () => {
  it('sorts and de-dupes materializer paths', () => {
    const snap = buildFrozenSnapshot('h1', ['/b', '/a', '/a'])
    expect(snap.materializerSet).toEqual(['/a', '/b'])
    expect(snap.systemHash).toBe('h1')
  })
})

describe('assertFrozenForWake', () => {
  it('passes when hash + materializer set match', async () => {
    await assertFrozenForWake({
      ...base,
      expected: buildFrozenSnapshot('h1', ['/a', '/b']),
      actual: buildFrozenSnapshot('h1', ['/b', '/a']),
    })
    expect(journals).toHaveLength(0)
  })

  it('throws + journals when system hash drifts', async () => {
    await expect(
      assertFrozenForWake({
        ...base,
        expected: buildFrozenSnapshot('h1', ['/a']),
        actual: buildFrozenSnapshot('h2', ['/a']),
      }),
    ).rejects.toBeInstanceOf(FrozenSnapshotViolationError)
    expect(journals).toHaveLength(1)
    expect(journals[0]?.type).toBe('frozen_snapshot_violation')
    expect(journals[0]?.event.expectedSystemHash).toBe('h1')
    expect(journals[0]?.event.actualSystemHash).toBe('h2')
  })

  it('throws + journals when a materializer was added between turns', async () => {
    await expect(
      assertFrozenForWake({
        ...base,
        expected: buildFrozenSnapshot('h1', ['/a']),
        actual: buildFrozenSnapshot('h1', ['/a', '/b']),
      }),
    ).rejects.toBeInstanceOf(FrozenSnapshotViolationError)
    const event = journals[0]?.event as { actualMaterializerSet: string[]; expectedMaterializerSet: string[] }
    expect(event.actualMaterializerSet).toEqual(['/a', '/b'])
    expect(event.expectedMaterializerSet).toEqual(['/a'])
  })

  it('error message lists missing + extra paths', async () => {
    try {
      await assertFrozenForWake({
        ...base,
        expected: buildFrozenSnapshot('h', ['/a', '/b']),
        actual: buildFrozenSnapshot('h', ['/a', '/c']),
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(FrozenSnapshotViolationError)
      expect(String(err)).toContain('/b')
      expect(String(err)).toContain('/c')
    }
  })
})
