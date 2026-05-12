import { describe, expect, it } from 'bun:test'

import { agentsSetInstructionsVerb } from './set-instructions'
import { agentsSetWorkingMemoryVerb } from './set-working-memory'

describe('agents set-instructions / set-working-memory input schema', () => {
  for (const verb of [agentsSetInstructionsVerb, agentsSetWorkingMemoryVerb]) {
    describe(verb.name, () => {
      it('accepts id + non-empty body', () => {
        const r = verb.inputSchema.safeParse({ id: 'agent_1', body: 'hello' })
        expect(r.success).toBe(true)
      })

      it('rejects when body is missing (CLI resolver should have translated --file)', () => {
        const r = verb.inputSchema.safeParse({ id: 'agent_1' })
        expect(r.success).toBe(false)
      })

      it('rejects when body is empty', () => {
        const r = verb.inputSchema.safeParse({ id: 'agent_1', body: '' })
        expect(r.success).toBe(false)
      })

      it('rejects when id is missing', () => {
        const r = verb.inputSchema.safeParse({ body: 'hello' })
        expect(r.success).toBe(false)
      })

      it('rejects when id is empty', () => {
        const r = verb.inputSchema.safeParse({ id: '', body: 'hello' })
        expect(r.success).toBe(false)
      })

      it('is admin-tier', () => {
        expect(verb.audience).toBe('admin')
      })
    })
  }
})
