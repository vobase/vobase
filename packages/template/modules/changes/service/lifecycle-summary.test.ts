import { describe, expect, it } from 'bun:test'

import { summarizeLifecycleEvent } from './lifecycle-summary'

describe('summarizeLifecycleEvent', () => {
  it('renders single string field with value', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'field_set', fields: { email: { from: null, to: 'marc@example.com' } } },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('Email change to marc@example.com')
  })

  it('uses humanised label for displayName', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'field_set', fields: { displayName: { from: 'Marc', to: 'Marc K. Chen' } } },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('Display name change to Marc K. Chen')
  })

  it('renders boolean as set-to-Yes/No', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'field_set', fields: { marketingOptOut: { from: false, to: true } } },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('Marketing opt-out set to Yes')
  })

  it('renders array values truncated', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'field_set', fields: { segments: { from: [], to: ['enterprise', 'vip'] } } },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('Segments change to enterprise, vip')
  })

  it('truncates long string values with ellipsis', () => {
    const long = 'a'.repeat(120)
    const summary = summarizeLifecycleEvent({
      payload: { kind: 'field_set', fields: { email: { from: null, to: long } } },
      resourceModule: 'contacts',
      resourceType: 'contact',
    })
    expect(summary.length).toBeLessThanOrEqual(80)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('humanises an unknown attributes.* key', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'field_set', fields: { 'attributes.industry': { from: null, to: 'logistics' } } },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('Industry change to logistics')
  })

  it('joins two fields with " and "', () => {
    expect(
      summarizeLifecycleEvent({
        payload: {
          kind: 'field_set',
          fields: {
            email: { from: null, to: 'marc@example.com' },
            phone: { from: null, to: '+1' },
          },
        },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('Email and phone change')
  })

  it('falls back to count for 3+ fields', () => {
    expect(
      summarizeLifecycleEvent({
        payload: {
          kind: 'field_set',
          fields: {
            email: { from: null, to: 'a@b.com' },
            phone: { from: null, to: '+1' },
            displayName: { from: null, to: 'Marc' },
          },
        },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('3 contact fields updated')
  })

  it('renders memory append/replace specially', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'markdown_patch', mode: 'append', field: 'memory', body: 'a new note' },
        resourceModule: 'agents',
        resourceType: 'agent_memory',
      }),
    ).toBe('Memory note appended')
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'markdown_patch', mode: 'replace', field: 'memory', body: 'rewritten' },
        resourceModule: 'agents',
        resourceType: 'agent_memory',
      }),
    ).toBe('Memory rewritten')
  })

  it('renders document append/replace generically', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'markdown_patch', mode: 'replace', field: 'body', body: 'new doc' },
        resourceModule: 'drive',
        resourceType: 'doc',
      }),
    ).toBe('Document rewritten')
  })

  it('falls back to "<noun> update" for unknown payload kinds', () => {
    expect(
      summarizeLifecycleEvent({
        payload: { kind: 'json_patch', ops: [{ op: 'replace', path: '/foo', value: 'bar' }] },
        resourceModule: 'contacts',
        resourceType: 'contact',
      }),
    ).toBe('Contact update')
  })
})
