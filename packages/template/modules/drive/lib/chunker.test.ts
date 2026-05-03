import { describe, expect, test } from 'bun:test'

import { chunkMarkdown } from './chunker'

describe('chunkMarkdown', () => {
  test('returns empty for empty input', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('   ')).toEqual([])
  })

  test('emits a single chunk for short input', () => {
    const chunks = chunkMarkdown('Hello world.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe('Hello world.')
    expect(chunks[0].index).toBe(0)
  })

  test('splits at paragraph boundaries when over cap', () => {
    const blob = `${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}\n\n${'c'.repeat(2000)}`
    const chunks = chunkMarkdown(blob, { maxTokens: 512, overlapTokens: 0 })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    // Every chunk under cap.
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(512 * 4 + 100)
  })

  test('hard-splits oversized single paragraph', () => {
    const huge = 'word '.repeat(2000) // ~10000 chars
    const chunks = chunkMarkdown(huge, { maxTokens: 200, overlapTokens: 0 })
    expect(chunks.length).toBeGreaterThan(1)
  })

  test('overlap is reflected in adjacent chunks', () => {
    const blob = `${'a'.repeat(800)}\n\n${'b'.repeat(800)}`
    const [c0, c1] = chunkMarkdown(blob, { maxTokens: 200, overlapTokens: 32 })
    expect(c0.content.startsWith('a')).toBe(true)
    expect(c1).toBeDefined()
    // overlap prefix shows trailing chars of c0 inside c1
    expect(c1.content).toContain('aaa')
  })
})
