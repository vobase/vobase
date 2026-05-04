/**
 * Lock test: mode chip label + variant mapping stays stable.
 * Prevents silent regression if chip semantics shift.
 */

import { describe, expect, test } from 'bun:test'

import { getModeChip, MODE_CHIP_MAP } from './channels-table'

describe('mode chip → label + variant mapping', () => {
  test('self cloud maps to Cloud API / info', () => {
    expect(MODE_CHIP_MAP.self_cloud).toEqual({ label: 'Cloud API', variant: 'info' })
  })

  test('self coexistence maps to Business App / success', () => {
    expect(MODE_CHIP_MAP.self_coexistence).toEqual({ label: 'Business App', variant: 'success' })
  })

  test('managed maps to Platform sandbox / info', () => {
    expect(MODE_CHIP_MAP.managed).toEqual({ label: 'Platform sandbox', variant: 'info' })
  })

  test('getModeChip: self + coexistence=false → Cloud API', () => {
    const chip = getModeChip({ mode: 'self', coexistence: false })
    expect(chip.label).toBe('Cloud API')
    expect(chip.variant).toBe('info')
  })

  test('getModeChip: self + coexistence=true → Business App', () => {
    const chip = getModeChip({ mode: 'self', coexistence: true })
    expect(chip.label).toBe('Business App')
    expect(chip.variant).toBe('success')
  })

  test('getModeChip: managed → Platform sandbox', () => {
    const chip = getModeChip({ mode: 'managed' })
    expect(chip.label).toBe('Platform sandbox')
    expect(chip.variant).toBe('info')
  })

  test('getModeChip: unknown → neutral empty label', () => {
    const chip = getModeChip({})
    expect(chip.label).toBe('')
    expect(chip.variant).toBe('neutral')
  })
})
