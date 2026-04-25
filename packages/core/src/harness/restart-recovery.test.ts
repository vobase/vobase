import { describe, expect, it } from 'bun:test'
import type { Bash } from 'just-bash'

import { createRestartRecoveryContributor } from './restart-recovery'
import type { SideLoadCtx } from './types'

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
