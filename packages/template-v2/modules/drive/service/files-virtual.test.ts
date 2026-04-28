/**
 * Unit tests for the contact-scope virtual-file overlay helpers:
 *   `resolveVirtualField`, `composeVirtualContent`, `stripVirtualHeader`.
 *
 * DB-backed paths (`readPath` / `writePath` hitting drive_files + contacts) are
 * exercised in the e2e suite alongside `factory-isolation`.
 */

import { describe, expect, it } from 'bun:test'

import { composeVirtualContent, resolveVirtualField, stripVirtualHeader } from './files'
import type { DriveScope } from './types'

const CONTACT_SCOPE: DriveScope = { scope: 'contact', contactId: 'ctc-1' }
const STAFF_SCOPE: DriveScope = { scope: 'staff', userId: 'alice' }
const ORG_SCOPE: DriveScope = { scope: 'organization' }

describe('resolveVirtualField (contact scope)', () => {
  it('maps contact:/PROFILE.md to profile', () => {
    expect(resolveVirtualField(CONTACT_SCOPE, '/PROFILE.md')).toBe('profile')
  })

  it('maps contact:/MEMORY.md to memory', () => {
    expect(resolveVirtualField(CONTACT_SCOPE, '/MEMORY.md')).toBe('memory')
  })

  it('returns null for organization scope', () => {
    expect(resolveVirtualField(ORG_SCOPE, '/PROFILE.md')).toBeNull()
    expect(resolveVirtualField(ORG_SCOPE, '/MEMORY.md')).toBeNull()
  })

  it('returns null for non-matching paths', () => {
    expect(resolveVirtualField(CONTACT_SCOPE, '/other.md')).toBeNull()
    expect(resolveVirtualField(CONTACT_SCOPE, '/profile.md')).toBeNull() // case-sensitive
    expect(resolveVirtualField(CONTACT_SCOPE, '/dir/PROFILE.md')).toBeNull()
  })
})

describe('resolveVirtualField (contact + staff)', () => {
  it('maps staff:/PROFILE.md to profile', () => {
    expect(resolveVirtualField(STAFF_SCOPE, '/PROFILE.md')).toBe('profile')
  })

  it('maps staff:/MEMORY.md to memory', () => {
    expect(resolveVirtualField(STAFF_SCOPE, '/MEMORY.md')).toBe('memory')
  })

  it('still maps contact-scope paths', () => {
    expect(resolveVirtualField(CONTACT_SCOPE, '/PROFILE.md')).toBe('profile')
    expect(resolveVirtualField(CONTACT_SCOPE, '/MEMORY.md')).toBe('memory')
  })

  it('returns null for org scope', () => {
    expect(resolveVirtualField(ORG_SCOPE, '/PROFILE.md')).toBeNull()
  })
})

describe('resolveVirtualField (agent)', () => {
  const AGENT_SCOPE: DriveScope = { scope: 'agent', agentId: 'agt-1' }

  it('maps agent:/AGENTS.md to instructions', () => {
    expect(resolveVirtualField(AGENT_SCOPE, '/AGENTS.md')).toBe('instructions')
  })

  it('maps agent:/MEMORY.md to memory', () => {
    expect(resolveVirtualField(AGENT_SCOPE, '/MEMORY.md')).toBe('memory')
  })

  it('returns null for agent:/NOTES.md (legacy path, no longer mapped in any scope)', () => {
    expect(resolveVirtualField(AGENT_SCOPE, '/NOTES.md')).toBeNull()
  })
})

describe('composeVirtualContent + stripVirtualHeader roundtrip', () => {
  it('prepends a sentinel header on read', () => {
    const out = composeVirtualContent('profile', 'Name: Ada\n\nNotes: likes tea.')
    expect(out.startsWith('<!-- drive:virtual field=profile')).toBe(true)
    expect(out).toContain('Name: Ada')
  })

  it('handles empty body', () => {
    const out = composeVirtualContent('memory', '')
    expect(out).toMatch(/^<!-- drive:virtual field=memory.*-->\n$/)
  })

  it('stripVirtualHeader removes a single sentinel and leading blank', () => {
    const composed = composeVirtualContent('memory', 'hello\nworld')
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
      '<!-- drive:virtual field=memory source=contacts.memory -->',
      'real body',
    ].join('\n')
    expect(stripVirtualHeader(input)).toBe('real body')
  })
})
