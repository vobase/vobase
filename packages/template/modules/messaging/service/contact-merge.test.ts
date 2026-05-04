/**
 * Tests for the contact-merge Zod payload schema. The merge implementation is
 * a JSDoc-only skeleton — `test.todo` reserves the slot for the eventual
 * behaviour assertions without pretending the placeholder is meaningful.
 */

import { describe, expect, test } from 'bun:test'

import { MergeContactsInput } from './contact-merge'

describe('mergeContacts skeleton', () => {
  const baseInput = {
    survivorId: 'contact-survivor',
    absorbedId: 'contact-absorbed',
    organizationId: 'org-123',
    by: { id: 'user-1', kind: 'user' as const },
  }

  test.skip('merges survivor + absorbed and appends conversation_events', () => {
    // Implementation pending — see contact-merge.ts JSDoc spec.
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
