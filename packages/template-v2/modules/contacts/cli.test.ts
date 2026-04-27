/**
 * `contactsProposeChangeVerb` Zod-validation tests.
 *
 * The verb body never runs when the input fails validation — these tests
 * exercise the schema directly so the dispatcher's behavior is provable
 * without spinning up the full HTTP transport.
 */

import { describe, expect, it } from 'bun:test'

import { contactsProposeChangeVerb } from './cli'

describe('contacts propose-change Zod validation', () => {
  it('rejects --confidence above the [0, 1] range', () => {
    const result = contactsProposeChangeVerb.inputSchema.safeParse({
      type: 'contact',
      id: 'ctt0test00',
      kind: 'markdown_patch',
      field: 'notes',
      mode: 'append',
      body: 'hello',
      confidence: 1.5,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fieldIssue = result.error.issues.find((i) => i.path.includes('confidence'))
      expect(fieldIssue).toBeDefined()
    }
  })

  it('rejects negative confidence', () => {
    const result = contactsProposeChangeVerb.inputSchema.safeParse({
      type: 'contact',
      id: 'ctt0test00',
      kind: 'markdown_patch',
      field: 'notes',
      body: 'hello',
      confidence: -0.1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects markdown_patch without body', () => {
    const result = contactsProposeChangeVerb.inputSchema.safeParse({
      type: 'contact',
      id: 'ctt0test00',
      kind: 'markdown_patch',
      field: 'notes',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('body'))).toBe(true)
    }
  })

  it('rejects field_set without --to', () => {
    const result = contactsProposeChangeVerb.inputSchema.safeParse({
      type: 'contact',
      id: 'ctt0test00',
      kind: 'field_set',
      field: 'displayName',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('to'))).toBe(true)
    }
  })

  it('accepts a valid markdown_patch payload', () => {
    const result = contactsProposeChangeVerb.inputSchema.safeParse({
      type: 'contact',
      id: 'ctt0test00',
      kind: 'markdown_patch',
      field: 'notes',
      mode: 'append',
      body: 'a note',
      confidence: 0.9,
      rationale: 'because',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid field_set payload', () => {
    const result = contactsProposeChangeVerb.inputSchema.safeParse({
      type: 'contact',
      id: 'ctt0test00',
      kind: 'field_set',
      field: 'email',
      from: 'old@x.test',
      to: 'new@x.test',
    })
    expect(result.success).toBe(true)
  })
})
