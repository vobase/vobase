/**
 * Unit tests for contacts handler E.164 phone validation.
 * No database required — tests the Zod schema directly.
 */

import { describe, expect, it } from 'bun:test'
import { E164_RE } from '@auth/e164'
import { z } from 'zod'

// Re-define the phone schema inline so the test doesn't import the full handler
// (which pulls in DB deps). This mirrors what the handler validates.
const e164Phone = z
  .string()
  .trim()
  .regex(E164_RE, 'Phone must be E.164 format with leading + (e.g. +6591234567)')
  .nullable()
  .optional()

const contactBody = z.object({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: e164Phone,
  segments: z.array(z.string().min(1)).optional(),
  marketingOptOut: z.boolean().optional(),
})

describe('contacts handler — phone E.164 validation', () => {
  it('accepts a valid E.164 number', () => {
    expect(contactBody.safeParse({ phone: '+6591234567' }).success).toBe(true)
    expect(contactBody.safeParse({ phone: '+14155550100' }).success).toBe(true)
  })

  it('accepts null (contact may have no phone)', () => {
    expect(contactBody.safeParse({ phone: null }).success).toBe(true)
  })

  it('accepts undefined (field omitted)', () => {
    expect(contactBody.safeParse({}).success).toBe(true)
  })

  it('rejects a free-form number without leading +', () => {
    const result = contactBody.safeParse({ phone: '91234567' })
    expect(result.success).toBe(false)
  })

  it('rejects a number with spaces', () => {
    // Trim strips leading/trailing whitespace but spaces inside the number
    // won't match E164_RE (the regex requires digits only after +).
    const result = contactBody.safeParse({ phone: '+65 9123 4567' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty string', () => {
    // Empty string after trim does not match E164_RE.
    const result = contactBody.safeParse({ phone: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a number that is too short', () => {
    const result = contactBody.safeParse({ phone: '+123' })
    expect(result.success).toBe(false)
  })
})
