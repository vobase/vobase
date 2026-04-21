import { describe, expect, it } from 'bun:test'
import type { AgentDefinition } from '../schema'
import { BUILTIN_TOOL_NAMES, resolveAllowedTools } from './agent-definitions'

describe('resolveAllowedTools', () => {
  it('returns the built-ins when the per-agent allowlist is empty', () => {
    expect(resolveAllowedTools({ skillAllowlist: [] })).toEqual([...BUILTIN_TOOL_NAMES])
  })

  it('treats null skillAllowlist as empty', () => {
    expect(resolveAllowedTools({ skillAllowlist: null } as unknown as Pick<AgentDefinition, 'skillAllowlist'>)).toEqual(
      [...BUILTIN_TOOL_NAMES],
    )
  })

  it('appends per-agent tools after built-ins in declaration order', () => {
    expect(resolveAllowedTools({ skillAllowlist: ['reply', 'send_card'] })).toEqual([
      ...BUILTIN_TOOL_NAMES,
      'reply',
      'send_card',
    ])
  })

  it('dedupes when a built-in is also declared in the per-agent allowlist', () => {
    expect(resolveAllowedTools({ skillAllowlist: ['bash', 'reply', 'bash'] })).toEqual([...BUILTIN_TOOL_NAMES, 'reply'])
  })

  it('preserves per-agent order when no overlap with built-ins', () => {
    expect(resolveAllowedTools({ skillAllowlist: ['zeta', 'alpha', 'mu'] })).toEqual([
      ...BUILTIN_TOOL_NAMES,
      'zeta',
      'alpha',
      'mu',
    ])
  })
})
