/**
 * Unit test: PENDING/APPROVED/REJECTED/DISABLED → DiceUI Status variants.
 * Prevents silent regression if variant names shift.
 */

import { describe, expect, test } from 'bun:test'

import { TEMPLATE_STATUS_VARIANT_MAP } from './templates'

describe('template status → Status variant mapping', () => {
  test('PENDING maps to info', () => {
    expect(TEMPLATE_STATUS_VARIANT_MAP.PENDING).toBe('info')
  })

  test('APPROVED maps to success', () => {
    expect(TEMPLATE_STATUS_VARIANT_MAP.APPROVED).toBe('success')
  })

  test('REJECTED maps to error', () => {
    expect(TEMPLATE_STATUS_VARIANT_MAP.REJECTED).toBe('error')
  })

  test('DISABLED maps to warning', () => {
    expect(TEMPLATE_STATUS_VARIANT_MAP.DISABLED).toBe('warning')
  })

  test('all four statuses are covered', () => {
    expect(Object.keys(TEMPLATE_STATUS_VARIANT_MAP).sort()).toEqual(['APPROVED', 'DISABLED', 'PENDING', 'REJECTED'])
  })
})
