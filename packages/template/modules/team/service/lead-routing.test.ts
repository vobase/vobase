import { describe, expect, test } from 'bun:test'

import type { RoutingRule, RoutingRuleKind } from '../schema'
import { buildHaystack, orderByLeastRecentlyAssigned, pickKeywordMatch } from './lead-routing'

function rule(kind: RoutingRuleKind, partial: Partial<RoutingRule>): RoutingRule {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2, 10),
    organizationId: 'org1',
    kind,
    keyword: partial.keyword ?? null,
    pool: partial.pool ?? null,
    repUserId: partial.repUserId ?? null,
    priority: partial.priority ?? 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

describe('buildHaystack', () => {
  test('lowercases and collapses whitespace', () => {
    expect(buildHaystack('  SGX  Group', 'Financial   Services')).toBe('sgx group financial services')
  })

  test('tolerates missing fields', () => {
    expect(buildHaystack(undefined, 'Banking')).toBe('banking')
    expect(buildHaystack('Nike', undefined)).toBe('nike')
    expect(buildHaystack(undefined, undefined)).toBe('')
  })
})

describe('pickKeywordMatch', () => {
  const rules: RoutingRule[] = [
    rule('exclusive', { keyword: 'bank', repUserId: 'rep1' }),
    rule('exclusive', { keyword: 'sgx', repUserId: 'rep1' }),
    rule('exclusive', { keyword: 'marina bay sands', repUserId: 'rep1' }),
  ]

  test('returns null when nothing matches', () => {
    expect(pickKeywordMatch(rules, 'acme widgets')).toBeNull()
  })

  test('matches a keyword that is a substring of the haystack', () => {
    expect(pickKeywordMatch(rules, 'sgx group')?.keyword).toBe('sgx')
  })

  test('longest keyword wins when several match', () => {
    // "marina bay sands hotel" contains both "bank"? no — contains "marina bay sands".
    expect(pickKeywordMatch(rules, 'event at marina bay sands')?.keyword).toBe('marina bay sands')
  })

  test('longer keyword beats a shorter overlapping one', () => {
    const overlapping: RoutingRule[] = [
      rule('exclusive', { keyword: 'nus', repUserId: 'a' }),
      rule('exclusive', { keyword: 'nus event', repUserId: 'b' }),
    ]
    expect(pickKeywordMatch(overlapping, 'catering for a nus event')?.repUserId).toBe('b')
  })

  test('higher priority breaks an equal-length tie', () => {
    const tied: RoutingRule[] = [
      rule('exclusive', { keyword: 'aaa', repUserId: 'low', priority: 0 }),
      rule('exclusive', { keyword: 'bbb', repUserId: 'high', priority: 5 }),
    ]
    expect(pickKeywordMatch(tied, 'aaa bbb')?.repUserId).toBe('high')
  })

  test('keyword ascending breaks a full tie — deterministic', () => {
    const tied: RoutingRule[] = [
      rule('exclusive', { keyword: 'zzz', repUserId: 'z' }),
      rule('exclusive', { keyword: 'aaa', repUserId: 'a' }),
    ]
    expect(pickKeywordMatch(tied, 'aaa zzz')?.repUserId).toBe('a')
  })
})

describe('orderByLeastRecentlyAssigned', () => {
  test('never-assigned candidates sort first, by userId', () => {
    const lra = new Map<string, Date | null>([
      ['bob', new Date('2026-01-01')],
      ['amy', null],
      ['cal', null],
    ])
    expect(orderByLeastRecentlyAssigned(['bob', 'amy', 'cal'], lra)).toEqual(['amy', 'cal', 'bob'])
  })

  test('older assignment sorts before newer', () => {
    const lra = new Map<string, Date | null>([
      ['x', new Date('2026-03-01')],
      ['y', new Date('2026-01-01')],
      ['z', new Date('2026-02-01')],
    ])
    expect(orderByLeastRecentlyAssigned(['x', 'y', 'z'], lra)).toEqual(['y', 'z', 'x'])
  })

  test('missing-from-map is treated as never-assigned', () => {
    const lra = new Map<string, Date | null>([['known', new Date('2026-01-01')]])
    expect(orderByLeastRecentlyAssigned(['known', 'unknown'], lra)).toEqual(['unknown', 'known'])
  })

  test('round-robin distributes evenly — picking head then re-dating advances the rotation', () => {
    // Simulate three sequential routes across a 3-rep pool.
    const pool = ['r1', 'r2', 'r3']
    const lra = new Map<string, Date | null>([
      ['r1', null],
      ['r2', null],
      ['r3', null],
    ])
    const picks: string[] = []
    for (let i = 0; i < 6; i++) {
      const head = orderByLeastRecentlyAssigned(pool, lra)[0]
      picks.push(head)
      lra.set(head, new Date(2026, 0, 1, 0, 0, i)) // newest assignment
    }
    expect(picks).toEqual(['r1', 'r2', 'r3', 'r1', 'r2', 'r3'])
  })
})
