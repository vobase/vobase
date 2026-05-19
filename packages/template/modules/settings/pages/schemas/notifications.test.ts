/**
 * Zod parse tests for the per-user notification matrix form schema (US-024+).
 */
import { describe, expect, it } from 'bun:test'

import { notificationsSchema } from './notifications'

describe('notificationsSchema (matrix)', () => {
  it('accepts a fully-filled matrix', () => {
    const parsed = notificationsSchema.parse({
      matrix: {
        mention: { in_app: true, whatsapp: false, email: true },
        decision: { in_app: true, whatsapp: true, email: false },
        proposal: { in_app: true, whatsapp: false, email: false },
        admin_alert: { in_app: true, whatsapp: true, email: true },
      },
    })
    expect(parsed.matrix.mention?.in_app).toBe(true)
    expect(parsed.matrix.admin_alert?.email).toBe(true)
  })

  it('empty matrix object parses', () => {
    expect(notificationsSchema.parse({ matrix: {} })).toEqual({ matrix: {} })
  })

  it('omitted matrix defaults to {}', () => {
    expect(notificationsSchema.parse({})).toEqual({ matrix: {} })
  })

  it('partial cells are accepted', () => {
    const parsed = notificationsSchema.parse({ matrix: { decision: { whatsapp: true } } })
    expect(parsed.matrix.decision?.whatsapp).toBe(true)
  })

  it('non-boolean cell value rejected', () => {
    expect(() => notificationsSchema.parse({ matrix: { mention: { in_app: 'yes' } } })).toThrow()
  })
})
