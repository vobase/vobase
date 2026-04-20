import { describe, expect, it } from 'bun:test'
import { createRestartRecoveryContributor } from './restart-recovery'

// ── helpers ──────────────────────────────────────────────────────────────────

function stubTail(interrupted: boolean) {
  return async (_conversationId: string) => ({ interrupted })
}

async function runContributor(interrupted: boolean, turnCount = 1): Promise<string[]> {
  const contributor = createRestartRecoveryContributor('conv-1', stubTail(interrupted))
  const results: string[] = []
  for (let i = 0; i < turnCount; i++) {
    // contribute() ignores the ctx in the current implementation; pass minimal shape
    const body = await contributor.contribute({
      organizationId: 't1',
      conversationId: 'conv-1',
      agentId: 'a1',
      contactId: 'k1',
      turnIndex: i,
      bash: null as never,
    })
    results.push(body)
  }
  return results
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('createRestartRecoveryContributor', () => {
  it('priority is 100', () => {
    const c = createRestartRecoveryContributor('c1', stubTail(false))
    expect(c.priority).toBe(100)
  })

  it('interrupted tail → injects block on turn 0', async () => {
    const [turn0] = await runContributor(true, 1)
    expect(turn0).toContain('<previous-turn-interrupted>')
    expect(turn0).toContain('</previous-turn-interrupted>')
  })

  it('non-interrupted tail → empty string on turn 0', async () => {
    const [turn0] = await runContributor(false, 1)
    expect(turn0).toBe('')
  })

  it('block injected only on turn 0, empty on subsequent turns', async () => {
    const [turn0, turn1, turn2] = await runContributor(true, 3)
    expect(turn0).toContain('<previous-turn-interrupted>')
    expect(turn1).toBe('')
    expect(turn2).toBe('')
  })

  it('no injection on turn 0 when not interrupted, stays empty', async () => {
    const [turn0, turn1] = await runContributor(false, 2)
    expect(turn0).toBe('')
    expect(turn1).toBe('')
  })

  it('uses the conversationId passed to the factory', async () => {
    const seen: string[] = []
    const c = createRestartRecoveryContributor('my-conv', async (cid) => {
      seen.push(cid)
      return { interrupted: false }
    })
    await c.contribute({
      organizationId: 't1',
      conversationId: 'my-conv',
      agentId: 'a1',
      contactId: 'k1',
      turnIndex: 0,
      bash: null as never,
    })
    expect(seen).toEqual(['my-conv'])
  })
})
