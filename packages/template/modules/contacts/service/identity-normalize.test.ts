import { describe, expect, it } from 'bun:test'

import { normalizeEmail, normalizePhoneE164 } from './identity-normalize'

describe('normalizePhoneE164', () => {
  it('strips non-digits and prepends +', () => {
    expect(normalizePhoneE164('+65 1234 5678')).toBe('+6512345678')
    expect(normalizePhoneE164('+1 (415) 555-0100')).toBe('+14155550100')
    expect(normalizePhoneE164('6512345678')).toBe('+6512345678')
  })

  it('passes through already-canonical values', () => {
    expect(normalizePhoneE164('+6512345678')).toBe('+6512345678')
  })

  it('rejects too-short and too-long values', () => {
    expect(normalizePhoneE164('123456')).toBeNull()
    expect(normalizePhoneE164('1234567890123456')).toBeNull()
  })

  it('rejects empty / null / undefined', () => {
    expect(normalizePhoneE164('')).toBeNull()
    expect(normalizePhoneE164(null)).toBeNull()
    expect(normalizePhoneE164(undefined)).toBeNull()
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Carl@Voltade.com  ')).toBe('carl@voltade.com')
  })

  it('rejects values without @', () => {
    expect(normalizeEmail('not an email')).toBeNull()
  })

  it('rejects empty / null', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })
})
