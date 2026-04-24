import { describe, expect, test } from 'bun:test'

import { CircuitBreaker } from './circuit-breaker'

describe('CircuitBreaker', () => {
  test('starts closed and allows requests', () => {
    const cb = new CircuitBreaker({ threshold: 3, resetTimeout: 100 })
    expect(cb.isOpen()).toBe(false)
    expect(cb.isHalfOpen()).toBe(false)
  })

  test('opens after threshold failures', () => {
    const cb = new CircuitBreaker({ threshold: 3, resetTimeout: 100 })
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(false)
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)
  })

  test('transitions to half-open after resetTimeout', async () => {
    const cb = new CircuitBreaker({ threshold: 2, resetTimeout: 50 })
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)

    await Bun.sleep(60)

    expect(cb.isOpen()).toBe(false)
    expect(cb.isHalfOpen()).toBe(true)
  })

  test('closes on success in half-open state', async () => {
    const cb = new CircuitBreaker({ threshold: 2, resetTimeout: 50 })
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)

    await Bun.sleep(60)
    expect(cb.isHalfOpen()).toBe(true)

    cb.recordSuccess()
    expect(cb.isOpen()).toBe(false)
    expect(cb.isHalfOpen()).toBe(false)
  })

  test('re-opens on failure in half-open state', async () => {
    const cb = new CircuitBreaker({ threshold: 2, resetTimeout: 50 })
    cb.recordFailure()
    cb.recordFailure()

    await Bun.sleep(60)
    expect(cb.isHalfOpen()).toBe(true)

    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)
    expect(cb.isHalfOpen()).toBe(false)
  })

  test('resets failure count on success', () => {
    const cb = new CircuitBreaker({ threshold: 3, resetTimeout: 100 })
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(false)

    cb.recordSuccess()

    // After reset, need threshold failures again to open
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(false)
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)
  })
})
