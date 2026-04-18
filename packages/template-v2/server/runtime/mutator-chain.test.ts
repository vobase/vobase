import { describe, expect, it } from 'bun:test'
import type { AgentStep, MutatorContext } from '@server/contracts/mutator'
import { MutatorChain } from './mutator-chain'

const step = (args: unknown = {}): AgentStep => ({ toolCallId: 'tc1', toolName: 'send_text', args })
const ctx: MutatorContext = {} as MutatorContext

describe('MutatorChain', () => {
  it('returns undefined when every mutator passes', async () => {
    const chain = new MutatorChain([
      { id: 'm1', before: async () => undefined },
      { id: 'm2', before: async () => undefined },
    ])
    const decision = await chain.runBefore(step(), ctx)
    expect(decision).toBeUndefined()
  })

  it('first {action:block} wins; subsequent mutators are not called', async () => {
    let m2Calls = 0
    const chain = new MutatorChain([
      { id: 'm1', before: async () => ({ action: 'block', reason: 'stop' }) },
      {
        id: 'm2',
        before: async () => {
          m2Calls++
          return undefined
        },
      },
    ])
    const decision = await chain.runBefore(step(), ctx)
    expect(decision).toEqual({ action: 'block', reason: 'stop' })
    expect(m2Calls).toBe(0)
  })

  it('transform rewrites args for downstream mutators', async () => {
    const seenByM2: unknown[] = []
    const chain = new MutatorChain([
      { id: 'm1', before: async () => ({ action: 'transform', args: { rewritten: true } }) },
      {
        id: 'm2',
        before: async (s) => {
          seenByM2.push(s.args)
          return undefined
        },
      },
    ])
    await chain.runBefore(step({ original: true }), ctx)
    expect(seenByM2).toEqual([{ rewritten: true }])
  })

  it('empty chain returns undefined', async () => {
    const decision = await MutatorChain.empty().runBefore(step(), ctx)
    expect(decision).toBeUndefined()
  })
})
