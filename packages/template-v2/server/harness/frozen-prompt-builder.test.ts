import { describe, expect, it } from 'bun:test'

import { buildActiveIdsPreamble } from './frozen-prompt-builder'

describe('buildActiveIdsPreamble', () => {
  it('renders the conversational form when contactId + channelInstanceId are present', () => {
    const line = buildActiveIdsPreamble({
      agentId: 'a_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
    })
    expect(line).toBe(
      'You are /agents/a_test/, conversing with /contacts/c_test/ via /contacts/c_test/ci_test/. Latest at /contacts/c_test/ci_test/messages.md.',
    )
  })

  it('renders the agent-only form when contactId is absent', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test', channelInstanceId: 'ci_test' })
    expect(line).toBe('You are /agents/a_test/.')
  })

  it('renders the agent-only form when channelInstanceId is absent', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test', contactId: 'c_test' })
    expect(line).toBe('You are /agents/a_test/.')
  })

  it('renders the agent-only form when both optional ids are absent', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test' })
    expect(line).toBe('You are /agents/a_test/.')
  })

  it('never emits empty-slot interpolation artifacts', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test' })
    expect(line).not.toContain('undefined')
    expect(line).not.toContain('<none>')
    expect(line).not.toContain('//')
  })

  it('does not reference /conversations/ anywhere in the final form', () => {
    const full = buildActiveIdsPreamble({ agentId: 'a_test', contactId: 'c_test', channelInstanceId: 'ci_test' })
    expect(full).not.toContain('/conversations/')
  })
})
