import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { deriveUsage } from './derive-usage'

describe('deriveUsage', () => {
  it('renders required string fields as <string>', () => {
    const u = deriveUsage('team get', z.object({ user: z.string() }))
    expect(u).toBe('vobase team get --user=<string>')
  })

  it('wraps optional fields in [...]', () => {
    const u = deriveUsage(
      'conv reassign',
      z.object({ to: z.string(), reason: z.string().optional(), conversationId: z.string().optional() }),
    )
    expect(u).toBe('vobase conv reassign --to=<string> [--reason=<string>] [--conversationId=<string>]')
  })

  it('renders empty objects as bare verb name', () => {
    const u = deriveUsage('team list', z.object({}))
    expect(u).toBe('vobase team list')
  })

  it('renders numbers + integer-checked numbers distinctly', () => {
    const u = deriveUsage(
      'foo bar',
      z.object({ confidence: z.number().min(0).max(1), limit: z.number().int().optional() }),
    )
    expect(u).toContain('--confidence=<number>')
    expect(u).toContain('[--limit=<integer>]')
  })

  it('renders booleans as bare flags (no value)', () => {
    const u = deriveUsage('foo', z.object({ verbose: z.boolean(), trace: z.boolean().optional() }))
    expect(u).toBe('vobase foo --verbose [--trace]')
  })

  it('renders enums as <a|b|c>', () => {
    const u = deriveUsage('inbox tab', z.object({ tab: z.enum(['active', 'later', 'done']) }))
    expect(u).toBe('vobase inbox tab --tab=<active|later|done>')
  })

  it('renders union-of-literals as <a|b|c>', () => {
    const u = deriveUsage(
      'transition',
      z.object({ to: z.union([z.literal('open'), z.literal('closed'), z.literal('held')]) }),
    )
    expect(u).toBe('vobase transition --to=<open|closed|held>')
  })

  it('renders single literal as <value>', () => {
    const u = deriveUsage('foo', z.object({ kind: z.literal('agent') }))
    expect(u).toBe('vobase foo --kind=<agent>')
  })

  it('renders array fields with comma-list hint', () => {
    const u = deriveUsage('mention', z.object({ tags: z.array(z.string()) }))
    expect(u).toBe('vobase mention --tags=<string,…>')
  })

  it('unwraps z.default() so the field reads as optional', () => {
    const u = deriveUsage('foo', z.object({ limit: z.number().default(10) }))
    expect(u).toBe('vobase foo [--limit=<number>]')
  })

  it('unwraps z.refine effects so refined strings still render as <string>', () => {
    const refined = z.string().refine((v) => v.length > 0, 'non-empty')
    const u = deriveUsage('foo', z.object({ tag: refined }))
    expect(u).toBe('vobase foo --tag=<string>')
  })

  it("falls back to <value> for shapes the walker doesn't recognise", () => {
    const u = deriveUsage('foo', z.object({ blob: z.unknown() }))
    expect(u).toContain('--blob=<value>')
  })
})
