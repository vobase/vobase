/**
 * Unit tests for `wake/learning/thresholds.ts`.
 *
 * Uses `loadThresholds()` (re-reads env on each call) so tests can mutate
 * `process.env` and verify override behaviour without stale module state.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { envNumber, loadThresholds } from './thresholds'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'LEARN_T_REVIEW',
  'LEARN_T_AUTO_BASE',
  'LEARN_S_HEADROOM',
  'LEARN_DEBOUNCE_MS',
  'LEARN_CANDIDATE_EXPIRY_DAYS',
  'LEARN_SIDELOAD_CAP',
] as const

let saved: Partial<Record<string, string>> = {}

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = saved[k]
    }
  }
})

// ---------------------------------------------------------------------------
// triageModel
// ---------------------------------------------------------------------------

describe('triageModel', () => {
  it('is exactly the string "gpt_mini"', () => {
    expect(loadThresholds().triageModel).toBe('gpt_mini')
  })
})

// ---------------------------------------------------------------------------
// Default values (plan §8)
// ---------------------------------------------------------------------------

describe('defaults', () => {
  it('tReview defaults to 0.3', () => {
    expect(loadThresholds().tReview).toBe(0.3)
  })

  it('tAutoBase defaults to 0.7', () => {
    expect(loadThresholds().tAutoBase).toBe(0.7)
  })

  it('sensitivityHeadroom defaults to 0.3', () => {
    expect(loadThresholds().sensitivityHeadroom).toBe(0.3)
  })

  it('triageDebounceMs defaults to 300_000', () => {
    expect(loadThresholds().triageDebounceMs).toBe(300_000)
  })

  it('candidateExpiryDays defaults to 7', () => {
    expect(loadThresholds().candidateExpiryDays).toBe(7)
  })

  it('candidateSideLoadCap defaults to 5', () => {
    expect(loadThresholds().candidateSideLoadCap).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Env overrides
// ---------------------------------------------------------------------------

describe('env overrides', () => {
  it('reads LEARN_T_REVIEW from env', () => {
    process.env.LEARN_T_REVIEW = '0.5'
    expect(loadThresholds().tReview).toBe(0.5)
  })

  it('reads LEARN_T_AUTO_BASE from env', () => {
    process.env.LEARN_T_AUTO_BASE = '0.8'
    expect(loadThresholds().tAutoBase).toBe(0.8)
  })

  it('reads LEARN_S_HEADROOM from env', () => {
    process.env.LEARN_S_HEADROOM = '0.2'
    expect(loadThresholds().sensitivityHeadroom).toBe(0.2)
  })

  it('reads LEARN_DEBOUNCE_MS from env', () => {
    process.env.LEARN_DEBOUNCE_MS = '60000'
    expect(loadThresholds().triageDebounceMs).toBe(60_000)
  })

  it('reads LEARN_CANDIDATE_EXPIRY_DAYS from env', () => {
    process.env.LEARN_CANDIDATE_EXPIRY_DAYS = '14'
    expect(loadThresholds().candidateExpiryDays).toBe(14)
  })

  it('reads LEARN_SIDELOAD_CAP from env', () => {
    process.env.LEARN_SIDELOAD_CAP = '10'
    expect(loadThresholds().candidateSideLoadCap).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Invalid env values fall back to defaults
// ---------------------------------------------------------------------------

describe('invalid env values', () => {
  it('falls back when LEARN_T_REVIEW is "abc"', () => {
    process.env.LEARN_T_REVIEW = 'abc'
    expect(loadThresholds().tReview).toBe(0.3)
  })

  it('falls back when LEARN_T_AUTO_BASE is empty string', () => {
    process.env.LEARN_T_AUTO_BASE = ''
    expect(loadThresholds().tAutoBase).toBe(0.7)
  })

  it('falls back when LEARN_S_HEADROOM is "NaN"', () => {
    process.env.LEARN_S_HEADROOM = 'NaN'
    expect(loadThresholds().sensitivityHeadroom).toBe(0.3)
  })

  it('falls back when LEARN_DEBOUNCE_MS is "Infinity"', () => {
    process.env.LEARN_DEBOUNCE_MS = 'Infinity'
    expect(loadThresholds().triageDebounceMs).toBe(300_000)
  })
})

// ---------------------------------------------------------------------------
// envNumber helper
// ---------------------------------------------------------------------------

describe('envNumber', () => {
  it('returns fallback when env var is absent', () => {
    delete process.env.__TEST_NONEXISTENT__
    expect(envNumber('__TEST_NONEXISTENT__', 42)).toBe(42)
  })

  it('returns parsed number when env var is valid', () => {
    process.env.__TEST_NUM__ = '99'
    expect(envNumber('__TEST_NUM__', 0)).toBe(99)
    delete process.env.__TEST_NUM__
  })

  it('returns fallback for non-numeric string', () => {
    process.env.__TEST_NAN__ = 'hello'
    expect(envNumber('__TEST_NAN__', 7)).toBe(7)
    delete process.env.__TEST_NAN__
  })

  it('returns fallback for Infinity', () => {
    process.env.__TEST_INF__ = 'Infinity'
    expect(envNumber('__TEST_INF__', 3)).toBe(3)
    delete process.env.__TEST_INF__
  })
})
