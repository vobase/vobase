import { describe, expect, test } from 'bun:test'

import { encodeVector } from './embeddings'

describe('encodeVector', () => {
  test('formats vector as Postgres bracketed text', () => {
    expect(encodeVector([0.1, 0.2, -0.3])).toBe('[0.1,0.2,-0.3]')
  })

  test('handles single-element vector', () => {
    expect(encodeVector([1])).toBe('[1]')
  })

  test('handles empty', () => {
    expect(encodeVector([])).toBe('[]')
  })
})

// Integration retry test removed: embedTexts requires OPENAI_API_KEY + ai SDK,
// which is mocked in the integration test for the drive job (see jobs.test).
