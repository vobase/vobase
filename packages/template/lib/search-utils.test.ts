import { describe, expect, it } from 'bun:test'

import { buildRankMap, computeRRFScores } from './search-utils'

describe('buildRankMap', () => {
  it('assigns 1-based ranks', () => {
    const ranks = buildRankMap(['a', 'b', 'c'])
    expect(ranks.get('a')).toBe(1)
    expect(ranks.get('b')).toBe(2)
    expect(ranks.get('c')).toBe(3)
  })

  it('returns empty map for empty input', () => {
    const ranks = buildRankMap([])
    expect(ranks.size).toBe(0)
  })
})

describe('computeRRFScores', () => {
  it('returns empty array for empty rank lists', () => {
    expect(computeRRFScores([])).toEqual([])
  })

  it('computes scores from a single rank list', () => {
    const ranks = buildRankMap(['a', 'b'])
    const scores = computeRRFScores([ranks])

    expect(scores).toHaveLength(2)
    expect(scores[0].id).toBe('a')
    expect(scores[1].id).toBe('b')
    // rank 1 with k=60: 1/(60+1) ≈ 0.01639
    expect(scores[0].score).toBeCloseTo(1 / 61, 5)
    expect(scores[1].score).toBeCloseTo(1 / 62, 5)
  })

  it('merges two rank lists with RRF fusion', () => {
    const list1 = buildRankMap(['a', 'b', 'c'])
    const list2 = buildRankMap(['b', 'c', 'a'])
    const scores = computeRRFScores([list1, list2])

    expect(scores).toHaveLength(3)
    // 'b' is rank 2 in list1, rank 1 in list2 → highest combined score
    expect(scores[0].id).toBe('b')
    // 'a' is rank 1+3, 'c' is rank 3+2 — both benefit from appearing in both lists
    // All three items should be present
    const ids = scores.map((s) => s.id)
    expect(ids).toContain('a')
    expect(ids).toContain('c')
  })

  it('handles items appearing in only one list', () => {
    const list1 = buildRankMap(['a', 'b'])
    const list2 = buildRankMap(['c', 'b'])
    const scores = computeRRFScores([list1, list2])

    expect(scores).toHaveLength(3)
    // 'b' appears in both lists → highest score
    expect(scores[0].id).toBe('b')
  })

  it('respects custom k parameter', () => {
    const ranks = buildRankMap(['a'])
    const scores = computeRRFScores([ranks], 10)
    // rank 1 with k=10: 1/(10+1)
    expect(scores[0].score).toBeCloseTo(1 / 11, 5)
  })

  it('returns results sorted by descending score', () => {
    const list1 = buildRankMap(['a', 'b', 'c', 'd'])
    const list2 = buildRankMap(['d', 'c', 'b', 'a'])
    const scores = computeRRFScores([list1, list2])

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score)
    }
  })
})
