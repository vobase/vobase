/**
 * Unit tests for the contact-scope virtual-file overlay helpers:
 *   `resolveContactVirtualField`, `composeVirtualContent`, `stripVirtualHeader`.
 *
 * DB-backed paths (`readPath` / `writePath` hitting drive_files + contacts) are
 * exercised in the e2e suite alongside `factory-isolation`.
 */

import { describe, expect, it } from 'bun:test'
import { composeVirtualContent, resolveContactVirtualField, stripVirtualHeader } from './files'
import type { DriveScope } from './types'

const CONTACT_SCOPE: DriveScope = { scope: 'contact', contactId: 'ctc-1' }
const ORG_SCOPE: DriveScope = { scope: 'organization' }

describe('resolveContactVirtualField', () => {
  it('maps contact:/PROFILE.md to profile', () => {
    expect(resolveContactVirtualField(CONTACT_SCOPE, '/PROFILE.md')).toBe('profile')
  })

  it('maps contact:/NOTES.md to notes', () => {
    expect(resolveContactVirtualField(CONTACT_SCOPE, '/NOTES.md')).toBe('notes')
  })

  it('returns null for organization scope', () => {
    expect(resolveContactVirtualField(ORG_SCOPE, '/PROFILE.md')).toBeNull()
    expect(resolveContactVirtualField(ORG_SCOPE, '/NOTES.md')).toBeNull()
  })

  it('returns null for non-matching paths', () => {
    expect(resolveContactVirtualField(CONTACT_SCOPE, '/other.md')).toBeNull()
    expect(resolveContactVirtualField(CONTACT_SCOPE, '/profile.md')).toBeNull() // case-sensitive
    expect(resolveContactVirtualField(CONTACT_SCOPE, '/dir/PROFILE.md')).toBeNull()
  })
})

describe('composeVirtualContent + stripVirtualHeader roundtrip', () => {
  it('prepends a sentinel header on read', () => {
    const out = composeVirtualContent('profile', 'Name: Ada\n\nNotes: likes tea.')
    expect(out.startsWith('<!-- drive:virtual field=profile')).toBe(true)
    expect(out).toContain('Name: Ada')
  })

  it('handles empty body', () => {
    const out = composeVirtualContent('notes', '')
    expect(out).toMatch(/^<!-- drive:virtual field=notes.*-->\n$/)
  })

  it('stripVirtualHeader removes a single sentinel and leading blank', () => {
    const composed = composeVirtualContent('notes', 'hello\nworld')
    const stripped = stripVirtualHeader(composed)
    expect(stripped).toBe('hello\nworld')
  })

  it('stripVirtualHeader leaves non-sentinel content untouched', () => {
    const body = '# Heading\n\nBody line'
    expect(stripVirtualHeader(body)).toBe(body)
  })

  it('stripVirtualHeader removes multiple/misordered sentinels', () => {
    const input = [
      '<!-- drive:virtual field=profile source=contacts.profile -->',
      '',
      '<!-- drive:virtual field=notes source=contacts.notes -->',
      'real body',
    ].join('\n')
    expect(stripVirtualHeader(input)).toBe('real body')
  })
})
