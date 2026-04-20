import { describe, expect, it } from 'bun:test'
import type { SideLoadContributor } from '@server/contracts/side-load'
import { Bash } from 'just-bash'
import { collectSideLoad } from './side-load-collector'

const CTX = {
  organizationId: 't',
  conversationId: 'c',
  agentId: 'a',
  contactId: 'k',
  turnIndex: 0,
}

describe('collectSideLoad', () => {
  it('returns empty string when no contributors + no materializers', async () => {
    const out = await collectSideLoad({
      ctx: CTX,
      contributors: [],
      bash: new Bash(),
    })
    expect(out).toBe('')
  })

  it('orders items by priority descending, joins with --- separator', async () => {
    const low: SideLoadContributor = async () => [{ kind: 'working_memory', priority: 1, render: () => 'LOW' }]
    const high: SideLoadContributor = async () => [{ kind: 'pending_approvals', priority: 10, render: () => 'HIGH' }]
    const out = await collectSideLoad({
      ctx: CTX,
      contributors: [low, high],
      bash: new Bash(),
    })
    const highPos = out.indexOf('HIGH')
    const lowPos = out.indexOf('LOW')
    expect(highPos).toBeGreaterThanOrEqual(0)
    expect(lowPos).toBeGreaterThan(highPos)
    expect(out).toContain('---')
  })

  it('swallows contributor throws without breaking the rest', async () => {
    const bad: SideLoadContributor = async () => {
      throw new Error('boom')
    }
    const good: SideLoadContributor = async () => [{ kind: 'custom', priority: 1, render: () => 'ok' }]
    const out = await collectSideLoad({
      ctx: CTX,
      contributors: [bad, good],
      bash: new Bash(),
    })
    expect(out).toContain('ok')
  })

  it('invokes customMaterializers with a bash-augmented ctx', async () => {
    const bash = new Bash()
    await bash.writeFile('/counter.txt', '5')
    const out = await collectSideLoad({
      ctx: CTX,
      contributors: [],
      bash,
      customMaterializers: [
        {
          kind: 'custom',
          priority: 1,
          contribute: async (c) => {
            const r = await c.bash.exec('cat /counter.txt')
            return `counter=${r.stdout.trim()}`
          },
        },
      ],
    })
    expect(out).toContain('counter=5')
  })
})
