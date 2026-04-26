import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Bash } from 'just-bash'

import { __resetJournalServiceForTests, installJournalService } from './journal'
import { createRestartRecoveryContributor, recoverOrphanedDispatches } from './restart-recovery'
import type { AgentTool, SideLoadCtx } from './types'

const ctx = { organizationId: 'o', conversationId: 'c', turnIndex: 0 } as unknown as SideLoadCtx
const bash = {} as Bash

describe('createRestartRecoveryContributor', () => {
  it('emits the interrupted block on the first call when tail.interrupted=true', async () => {
    const m = createRestartRecoveryContributor('conv_1', async () => ({ interrupted: true }))
    const out = (await m.contribute({ ...ctx, bash })) as string
    expect(out).toContain('<previous-turn-interrupted>')
    expect(out).toContain('Review the workspace state')
  })

  it('returns empty string when the previous turn was not interrupted', async () => {
    const m = createRestartRecoveryContributor('conv_1', async () => ({ interrupted: false }))
    const out = await m.contribute({ ...ctx, bash })
    expect(out).toBe('')
  })

  it('fires only once — subsequent calls return empty even if still interrupted', async () => {
    const m = createRestartRecoveryContributor('conv_1', async () => ({ interrupted: true }))
    const first = (await m.contribute({ ...ctx, bash })) as string
    const second = await m.contribute({ ...ctx, bash })
    expect(first).toContain('<previous-turn-interrupted>')
    expect(second).toBe('')
  })

  it('forwards conversationId to getLastWakeTail', async () => {
    let captured = ''
    // biome-ignore lint/suspicious/useAwait: getLastWakeTail contract requires async signature
    const m = createRestartRecoveryContributor('conv_abc', async (id) => {
      captured = id
      return { interrupted: false }
    })
    await m.contribute({ ...ctx, bash })
    expect(captured).toBe('conv_abc')
  })

  it('uses priority 100 so it sits above baseline contributors', () => {
    const m = createRestartRecoveryContributor('conv', async () => ({ interrupted: false }))
    expect(m.priority).toBe(100)
    expect(m.kind).toBe('custom')
  })
})

describe('recoverOrphanedDispatches', () => {
  let journals: Array<{ type: string }>
  beforeEach(() => {
    __resetJournalServiceForTests()
    journals = []
    installJournalService({
      append: (input) => {
        const ev = input.event as { type: string }
        journals.push({ type: ev.type })
        return Promise.resolve()
      },
      getLastWakeTail: () => Promise.resolve({ interrupted: false }),
      getLatestTurnIndex: () => Promise.resolve(0),
    })
  })
  afterEach(() => {
    __resetJournalServiceForTests()
  })

  const idempotent: Pick<AgentTool, 'name' | 'idempotent'> = { name: 'memory_set', idempotent: true }
  const sideEffectful: Pick<AgentTool, 'name' | 'idempotent'> = { name: 'send_reply', idempotent: false }

  it('returns empty when no orphans exist', async () => {
    const out = await recoverOrphanedDispatches({
      organizationId: 'o1',
      conversationId: 'c1',
      wakeId: 'w1',
      tools: [idempotent, sideEffectful],
      getWakeEvents: () => Promise.resolve([]),
    })
    expect(out.orphans).toHaveLength(0)
    expect(journals).toHaveLength(0)
  })

  it('classifies idempotent orphans as replayable; non-idempotent → lost + journal entry', async () => {
    const out = await recoverOrphanedDispatches({
      organizationId: 'o1',
      conversationId: 'c1',
      wakeId: 'w1',
      tools: [idempotent, sideEffectful],
      getWakeEvents: () =>
        Promise.resolve([
          {
            type: 'tool_dispatch_started',
            toolCallId: 'tc1',
            toolName: 'memory_set',
            idempotencyKey: 'w1:tc1',
            turnIndex: 0,
          },
          {
            type: 'tool_dispatch_started',
            toolCallId: 'tc2',
            toolName: 'send_reply',
            idempotencyKey: 'w1:tc2',
            turnIndex: 0,
          },
          {
            type: 'tool_dispatch_completed',
            toolCallId: 'tc-done',
            toolName: 'send_reply',
            idempotencyKey: 'w1:tc-done',
            turnIndex: 0,
            ok: true,
            durationMs: 10,
          },
        ]),
    })
    expect(out.orphans).toHaveLength(2)
    expect(out.replayable.map((o) => o.toolName)).toEqual(['memory_set'])
    expect(out.lost.map((o) => o.toolName)).toEqual(['send_reply'])
    expect(journals).toEqual([{ type: 'tool_dispatch_lost' }])
  })
})
