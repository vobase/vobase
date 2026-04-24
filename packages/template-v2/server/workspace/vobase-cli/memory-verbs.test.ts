import { describe, expect, it } from 'bun:test'
import type { CommandContext } from '@server/common/port-types'

import { memoryVerbs } from './memory-verbs'

const CTX: CommandContext = {
  organizationId: 't',
  conversationId: 'c',
  agentId: 'a',
  contactId: 'k',
  async writeWorkspace() {},
  async readWorkspace() {
    return ''
  },
}

describe('memoryVerbs', () => {
  it('ships all five Phase-1 stubs', () => {
    const names = memoryVerbs.map((v) => v.name).sort()
    expect(names).toEqual(['memory append', 'memory list', 'memory remove', 'memory set', 'memory view'])
  })

  it('returns not-implemented-in-phase-1 on execute', async () => {
    for (const verb of memoryVerbs) {
      const out = await verb.execute([], CTX)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.content).toBe('not-implemented in Phase 1')
    }
  })
})
