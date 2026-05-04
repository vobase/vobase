/**
 * Tests for contact-merge skeleton.
 * Asserts the throw so the spec doesn't silently slip.
 */

import { describe, expect, test } from 'bun:test'

import { MergeContactsInput, mergeContacts } from './contact-merge'

describe('mergeContacts skeleton', () => {
  const baseInput = {
    survivorId: 'contact-survivor',
    absorbedId: 'contact-absorbed',
    organizationId: 'org-123',
    by: { id: 'user-1', kind: 'user' as const },
  }

  test('throws not implemented', async () => {
    await expect(mergeContacts(baseInput)).rejects.toThrow('not implemented')
  })

  test('input schema validates correctly', () => {
    expect(() => MergeContactsInput.parse(baseInput)).not.toThrow()
  })

  test('input schema rejects missing survivorId', () => {
    expect(() => MergeContactsInput.parse({ ...baseInput, survivorId: '' })).toThrow()
  })

  test('input schema rejects missing absorbedId', () => {
    expect(() => MergeContactsInput.parse({ ...baseInput, absorbedId: '' })).toThrow()
  })

  test('input schema rejects invalid by.kind', () => {
    expect(() => MergeContactsInput.parse({ ...baseInput, by: { id: 'u1', kind: 'unknown' } })).toThrow()
  })
})
