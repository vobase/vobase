import { describe, expect, it } from 'bun:test'

import { generateToken, hashToken } from './api-keys'

describe('generateToken', () => {
  it('produces a vbt_-prefixed 28-char token', () => {
    const t = generateToken()
    expect(t.startsWith('vbt_')).toBe(true)
    expect(t.length).toBe(4 + 24)
  })

  it('is high-entropy (no collisions across 1k generations)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i += 1) seen.add(generateToken())
    expect(seen.size).toBe(1000)
  })

  it('uses the URL-safe base64 alphabet', () => {
    const t = generateToken()
    expect(t.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/u)
  })
})

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('vbt_x')).toBe(hashToken('vbt_x'))
  })

  it('differs across distinct inputs', () => {
    expect(hashToken('vbt_a')).not.toBe(hashToken('vbt_b'))
  })

  it('produces a 64-char hex digest (sha256)', () => {
    expect(hashToken('vbt_anything')).toMatch(/^[0-9a-f]{64}$/u)
  })
})
