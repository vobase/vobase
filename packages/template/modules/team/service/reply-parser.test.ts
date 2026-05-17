/**
 * Unit tests for `parseReplyText` (US-009 / Slice B.4).
 */

import { describe, expect, it } from 'bun:test'

import { parseReplyText } from './reply-parser'

describe('parseReplyText', () => {
  it('recognises plain "approve"', () => {
    expect(parseReplyText('approve')).toEqual({ decision: 'approve' })
  })

  it('is case-insensitive', () => {
    expect(parseReplyText('Approve')).toEqual({ decision: 'approve' })
    expect(parseReplyText('APPROVE please')).toEqual({ decision: 'approve', note: 'please' })
  })

  it('captures the trailing note after the verb', () => {
    expect(parseReplyText('approve looks good')).toEqual({ decision: 'approve', note: 'looks good' })
    expect(parseReplyText('approved, ship it')).toEqual({ decision: 'approve', note: ', ship it' })
  })

  it('treats short affirmatives as approve', () => {
    expect(parseReplyText('yes!')).toEqual({ decision: 'approve', note: '!' })
    expect(parseReplyText('y')).toEqual({ decision: 'approve' })
    expect(parseReplyText('ok')).toEqual({ decision: 'approve' })
  })

  it('recognises emoji ✅ as approve', () => {
    expect(parseReplyText('✅ go for it')).toEqual({ decision: 'approve', note: 'go for it' })
  })

  it('recognises plain "deny" and synonyms', () => {
    expect(parseReplyText('deny')).toEqual({ decision: 'deny' })
    expect(parseReplyText('no thanks')).toEqual({ decision: 'deny', note: 'thanks' })
    expect(parseReplyText('rejecting because X')).toEqual({ decision: 'unknown', note: 'rejecting because X' })
    expect(parseReplyText('rejected: bad call')).toEqual({ decision: 'deny', note: ': bad call' })
  })

  it('recognises emoji ❌ as deny', () => {
    expect(parseReplyText('❌ no')).toEqual({ decision: 'deny', note: 'no' })
  })

  it('falls through to unknown for free-form text', () => {
    expect(parseReplyText('hi there')).toEqual({ decision: 'unknown', note: 'hi there' })
  })

  it('returns unknown with no note for empty input', () => {
    expect(parseReplyText('')).toEqual({ decision: 'unknown' })
    expect(parseReplyText('   ')).toEqual({ decision: 'unknown' })
  })

  it('tolerates leading whitespace', () => {
    expect(parseReplyText('   approve')).toEqual({ decision: 'approve' })
    expect(parseReplyText('\tdeny')).toEqual({ decision: 'deny' })
  })
})
