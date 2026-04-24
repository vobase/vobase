import { describe, expect, it } from 'bun:test'

import type { Conversation } from '../../schema'
import { computeTab } from '../bucketing'

type C = Pick<Conversation, 'status' | 'snoozedUntil'>

const NOW = new Date('2026-04-20T10:00:00Z')

describe('computeTab', () => {
  it('resolved → done', () => {
    expect(computeTab({ status: 'resolved', snoozedUntil: null }, NOW)).toBe('done')
  })

  it('failed → done', () => {
    expect(computeTab({ status: 'failed', snoozedUntil: null }, NOW)).toBe('done')
  })

  it('active → active when not snoozed', () => {
    expect(computeTab({ status: 'active', snoozedUntil: null }, NOW)).toBe('active')
  })

  it('resolving → active', () => {
    expect(computeTab({ status: 'resolving', snoozedUntil: null }, NOW)).toBe('active')
  })

  it('awaiting_approval → active', () => {
    expect(computeTab({ status: 'awaiting_approval', snoozedUntil: null }, NOW)).toBe('active')
  })

  it('active + snoozed in the future → later', () => {
    const future = new Date(NOW.getTime() + 3600_000)
    expect(computeTab({ status: 'active', snoozedUntil: future }, NOW)).toBe('later')
  })

  it('active + snoozedUntil in the past → active', () => {
    const past = new Date(NOW.getTime() - 3600_000)
    expect(computeTab({ status: 'active', snoozedUntil: past }, NOW)).toBe('active')
  })

  it('resolved takes precedence over snoozedUntil', () => {
    const future = new Date(NOW.getTime() + 3600_000)
    expect(computeTab({ status: 'resolved', snoozedUntil: future }, NOW)).toBe('done')
  })

  it('failed takes precedence over snoozedUntil', () => {
    const future = new Date(NOW.getTime() + 3600_000)
    expect(computeTab({ status: 'failed', snoozedUntil: future }, NOW)).toBe('done')
  })

  it('buckets are disjoint (every conv lands in exactly one)', () => {
    const cases: { name: string; c: C; expected: 'active' | 'later' | 'done' }[] = [
      { name: 'resolved', c: { status: 'resolved', snoozedUntil: null }, expected: 'done' },
      { name: 'failed', c: { status: 'failed', snoozedUntil: null }, expected: 'done' },
      { name: 'active', c: { status: 'active', snoozedUntil: null }, expected: 'active' },
      {
        name: 'snoozed',
        c: { status: 'active', snoozedUntil: new Date(NOW.getTime() + 1000) },
        expected: 'later',
      },
    ]
    for (const { name, c, expected } of cases) {
      expect(`${name}:${computeTab(c, NOW)}`).toBe(`${name}:${expected}`)
    }
  })
})
