import { describe, expect, test } from 'bun:test'

import { hybridScore, rankCandidates } from './search'

describe('hybridScore', () => {
  test('weights vector 0.7 and keyword 0.3', () => {
    // distance = 0 → vector = 1; tsRank = 0 → score = 0.7
    expect(hybridScore({ cosineDistance: 0, tsRank: 0 })).toBeCloseTo(0.7, 5)
    // distance = 0; tsRank = 1 → 0.7 + 0.3 = 1.0
    expect(hybridScore({ cosineDistance: 0, tsRank: 1 })).toBeCloseTo(1.0, 5)
    // distance = 1; tsRank = 0 → 0
    expect(hybridScore({ cosineDistance: 1, tsRank: 0 })).toBeCloseTo(0, 5)
  })
})

describe('rankCandidates', () => {
  test('sorts descending by score', () => {
    const ranked = rankCandidates([
      { row: 'a', cosineDistance: 0.5, tsRank: 0 }, // 0.35
      { row: 'b', cosineDistance: 0.0, tsRank: 0.2 }, // 0.7 + 0.06 = 0.76
      { row: 'c', cosineDistance: 0.1, tsRank: 0 }, // 0.63
    ])
    expect(ranked.map((r) => r.row)).toEqual(['b', 'c', 'a'])
  })
})
