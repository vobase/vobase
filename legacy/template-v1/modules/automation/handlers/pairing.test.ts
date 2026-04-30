import { describe, expect, it } from 'bun:test'

/**
 * Test the rate limiter logic extracted from the pairing handler.
 * The checkRedeemRateLimit function is module-private, so we replicate
 * its logic here to validate the algorithm.
 */

const MAX_REDEEM_ATTEMPTS = 5
const REDEEM_WINDOW_MS = 5 * 60 * 1000

const redeemAttempts = new Map<string, { count: number; resetAt: number }>()

function checkRedeemRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = redeemAttempts.get(ip)
  if (!entry || entry.resetAt < now) {
    redeemAttempts.set(ip, { count: 1, resetAt: now + REDEEM_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= MAX_REDEEM_ATTEMPTS
}

describe('pairing rate limiter', () => {
  it('allows up to MAX_REDEEM_ATTEMPTS per IP', () => {
    const ip = '192.168.1.1'
    redeemAttempts.clear()

    for (let i = 0; i < MAX_REDEEM_ATTEMPTS; i++) {
      expect(checkRedeemRateLimit(ip)).toBe(true)
    }

    // 6th attempt should be rejected
    expect(checkRedeemRateLimit(ip)).toBe(false)
  })

  it('allows different IPs independently', () => {
    redeemAttempts.clear()

    for (let i = 0; i < MAX_REDEEM_ATTEMPTS; i++) {
      checkRedeemRateLimit('10.0.0.1')
    }

    // 10.0.0.1 is exhausted
    expect(checkRedeemRateLimit('10.0.0.1')).toBe(false)

    // 10.0.0.2 is fresh
    expect(checkRedeemRateLimit('10.0.0.2')).toBe(true)
  })

  it('resets after window expires', () => {
    redeemAttempts.clear()
    const ip = '10.0.0.3'

    // Exhaust the limit
    for (let i = 0; i <= MAX_REDEEM_ATTEMPTS; i++) {
      checkRedeemRateLimit(ip)
    }
    expect(checkRedeemRateLimit(ip)).toBe(false)

    // Simulate window expiry by manipulating the entry
    const entry = redeemAttempts.get(ip)
    if (!entry) throw new Error('Expected entry to exist')
    entry.resetAt = Date.now() - 1

    // Should be allowed again
    expect(checkRedeemRateLimit(ip)).toBe(true)
  })
})
