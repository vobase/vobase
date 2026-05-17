/**
 * Unit tests for `matchButtonPayload` (US-009 / Slice B.4).
 */

import { describe, expect, it } from 'bun:test'

import { matchButtonPayload } from './button-payload-matcher'

describe('matchButtonPayload', () => {
  it('matches a well-formed approve button id', () => {
    expect(matchButtonPayload({ type: 'button_reply', id: 'approve:apr0abcdef' })).toEqual({
      decision: 'approve',
      referenceId: 'apr0abcdef',
    })
  })

  it('matches a well-formed deny button id', () => {
    expect(matchButtonPayload({ type: 'button_reply', id: 'deny:prp0xyz' })).toEqual({
      decision: 'deny',
      referenceId: 'prp0xyz',
    })
  })

  it('returns null for a malformed id without a colon', () => {
    expect(matchButtonPayload({ type: 'button_reply', id: 'malformed' })).toBeNull()
  })

  it('returns null for a non-recognised verb', () => {
    expect(matchButtonPayload({ type: 'button_reply', id: 'snooze:apr0123' })).toBeNull()
  })

  it('returns null for a non-button_reply payload', () => {
    expect(matchButtonPayload({ type: 'text', text: 'hi' })).toBeNull()
  })

  it('returns null for null / undefined', () => {
    expect(matchButtonPayload(null)).toBeNull()
    expect(matchButtonPayload(undefined)).toBeNull()
  })

  it('returns null when id is not a string', () => {
    expect(matchButtonPayload({ type: 'button_reply', id: 42 })).toBeNull()
  })
})
