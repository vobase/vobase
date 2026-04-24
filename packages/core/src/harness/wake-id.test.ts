import { describe, expect, it } from 'bun:test'

import { newWakeId } from './wake-id'

describe('newWakeId', () => {
  it('mints a 12-character id', () => {
    expect(newWakeId()).toHaveLength(12)
  })

  it('produces unique ids across a large batch (collision guard)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) seen.add(newWakeId())
    expect(seen.size).toBe(10_000)
  })

  it('only emits url-safe nanoid characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(newWakeId()).toMatch(/^[A-Za-z0-9_-]{12}$/)
    }
  })
})
