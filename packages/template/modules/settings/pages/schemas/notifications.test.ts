/**
 * Zod parse tests for the per-user notification prefs form schema (US-010).
 */
import { describe, expect, it } from 'bun:test'

import { notificationsSchema } from './notifications'

describe('notificationsSchema', () => {
  it('accepts all five toggle keys', () => {
    const parsed = notificationsSchema.parse({
      mentionsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      approvalsEnabled: true,
      proposalsEnabled: false,
    })
    expect(parsed).toEqual({
      mentionsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      approvalsEnabled: true,
      proposalsEnabled: false,
    })
  })

  it('every toggle is optional — empty object parses', () => {
    expect(notificationsSchema.parse({})).toEqual({})
  })

  it('approvalsEnabled rejects non-boolean values', () => {
    expect(() => notificationsSchema.parse({ approvalsEnabled: 'yes' })).toThrow()
  })

  it('proposalsEnabled rejects non-boolean values', () => {
    expect(() => notificationsSchema.parse({ proposalsEnabled: 1 })).toThrow()
  })

  it('partial patch with just approvalsEnabled is valid', () => {
    expect(notificationsSchema.parse({ approvalsEnabled: false })).toEqual({ approvalsEnabled: false })
  })

  it('partial patch with just proposalsEnabled is valid', () => {
    expect(notificationsSchema.parse({ proposalsEnabled: true })).toEqual({ proposalsEnabled: true })
  })
})
