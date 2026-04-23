import { describe, expect, it } from 'bun:test'
import { buildActiveIdsPreamble } from './frozen-prompt-builder'

describe('buildActiveIdsPreamble', () => {
  it('renders the conversational form when all three ids are present', () => {
    const line = buildActiveIdsPreamble({
      agentId: 'a_test',
      contactId: 'c_test',
      conversationId: 'v_test',
    })
    expect(line).toBe('You are /agents/a_test/, working on /conversations/v_test/ with contact /contacts/c_test/.')
  })

  it('renders the agent-only form when contactId is absent', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test', conversationId: 'v_test' })
    expect(line).toBe('You are /agents/a_test/.')
  })

  it('renders the agent-only form when conversationId is absent', () => {
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
})
