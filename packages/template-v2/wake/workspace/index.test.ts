/**
 * Unit tests for `chainRoHints` — the helper that fans an RO path through
 * each module's `RoHintFn` and returns the first non-null match. PR 6 routes
 * every module's `agent.roHints` through this chain so the harness's RO error
 * stays grep-friendly.
 */

import { describe, expect, it } from 'bun:test'
import type { RoHintFn } from '@vobase/core'

import { chainRoHints } from './index'

describe('chainRoHints', () => {
  it('returns null when the chain is empty', () => {
    expect(chainRoHints([])('/anything')).toBeNull()
  })

  it('returns null when no hint matches', () => {
    const a: RoHintFn = (path) => (path.endsWith('/a.md') ? 'a-hint' : null)
    expect(chainRoHints([a])('/x/b.md')).toBeNull()
  })

  it('returns the first non-null hint, even when later hints also match', () => {
    const first: RoHintFn = () => 'first'
    const second: RoHintFn = () => 'second'
    expect(chainRoHints([first, second])('/anything')).toBe('first')
  })

  it('falls through to subsequent hints when earlier ones return null', () => {
    const drive: RoHintFn = (path) => (path.startsWith('/drive/') ? 'drive-hint' : null)
    const messaging: RoHintFn = (path) => (path.endsWith('/messages.md') ? 'messaging-hint' : null)
    const chained = chainRoHints([drive, messaging])
    expect(chained('/contacts/c1/ci1/messages.md')).toBe('messaging-hint')
    expect(chained('/drive/policies.md')).toBe('drive-hint')
  })

  it('treats empty string as a non-null match (does not fall through)', () => {
    const empty: RoHintFn = () => ''
    const after: RoHintFn = () => 'after'
    expect(chainRoHints([empty, after])('/any')).toBe('')
  })
})
