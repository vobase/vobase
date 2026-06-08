import { afterEach, describe, expect, test } from 'bun:test'

import { embeddingModelId, encodeVector, isBifrostMode } from './embeddings'

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

describe('provider selection', () => {
  const { BIFROST_API_KEY, BIFROST_URL } = process.env
  afterEach(() => {
    // Restore so we don't leak gateway mode into sibling tests in this process.
    process.env.BIFROST_API_KEY = BIFROST_API_KEY
    process.env.BIFROST_URL = BIFROST_URL
  })

  test('direct mode (no gateway vars) uses the bare OpenAI model id', () => {
    process.env.BIFROST_API_KEY = undefined
    process.env.BIFROST_URL = undefined
    expect(isBifrostMode()).toBe(false)
    expect(embeddingModelId()).toBe('text-embedding-3-small')
  })

  test('bifrost mode prefixes the model id so the gateway can route it', () => {
    process.env.BIFROST_API_KEY = 'bk'
    process.env.BIFROST_URL = 'https://gateway.example/v1'
    expect(isBifrostMode()).toBe(true)
    expect(embeddingModelId()).toBe('openai/text-embedding-3-small')
  })

  test('both gateway vars are required — key alone is still direct mode', () => {
    process.env.BIFROST_API_KEY = 'bk'
    process.env.BIFROST_URL = undefined
    expect(isBifrostMode()).toBe(false)
    expect(embeddingModelId()).toBe('text-embedding-3-small')
  })
})

// Integration retry test removed: embedTexts requires OPENAI_API_KEY + ai SDK,
// which is mocked in the integration test for the drive job (see jobs.test).
