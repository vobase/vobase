import { describe, expect, it } from 'bun:test'
import type { Bash } from 'just-bash'

import { createIdleResumptionContributor } from './idle-resumption'
import type { SideLoadCtx } from './types'

const ctx = { organizationId: 'o', conversationId: 'c', turnIndex: 0 } as unknown as SideLoadCtx
const bash = {} as Bash

function at(iso: string): Date {
  return new Date(iso)
}

describe('createIdleResumptionContributor', () => {
  const THRESHOLD = 24 * 60 * 60 * 1000 // 24h

  it('emits a days-formatted block when gap exceeds threshold', async () => {
    const m = createIdleResumptionContributor({
      conversationId: 'conv_1',
      thresholdMs: THRESHOLD,
      getLastActivityTime: async () => at('2026-04-18T12:00:00Z'),
      now: () => at('2026-04-24T12:00:00Z'),
    })
    const out = (await m.contribute({ ...ctx, bash })) as string
    expect(out).toContain('<conversation-idle-resume>')
    expect(out).toContain('6 days')
    expect(out).toContain('</conversation-idle-resume>')
  })

  it('returns empty when gap is below threshold', async () => {
    const m = createIdleResumptionContributor({
      conversationId: 'conv_1',
      thresholdMs: THRESHOLD,
      getLastActivityTime: async () => at('2026-04-24T08:00:00Z'),
      now: () => at('2026-04-24T12:00:00Z'),
    })
    const out = await m.contribute({ ...ctx, bash })
    expect(out).toBe('')
  })

  it('returns empty when no prior activity exists', async () => {
    const m = createIdleResumptionContributor({
      conversationId: 'conv_1',
      thresholdMs: THRESHOLD,
      getLastActivityTime: async () => null,
    })
    const out = await m.contribute({ ...ctx, bash })
    expect(out).toBe('')
  })

  it('fires only once per wake', async () => {
    const m = createIdleResumptionContributor({
      conversationId: 'conv_1',
      thresholdMs: THRESHOLD,
      getLastActivityTime: async () => at('2026-04-18T12:00:00Z'),
      now: () => at('2026-04-24T12:00:00Z'),
    })
    const first = (await m.contribute({ ...ctx, bash })) as string
    const second = await m.contribute({ ...ctx, bash })
    expect(first).toContain('<conversation-idle-resume>')
    expect(second).toBe('')
  })

  it('formats hour-range gaps', async () => {
    const m = createIdleResumptionContributor({
      conversationId: 'conv_1',
      thresholdMs: 60 * 60 * 1000, // 1h
      getLastActivityTime: async () => at('2026-04-24T08:00:00Z'),
      now: () => at('2026-04-24T12:00:00Z'),
    })
    const out = (await m.contribute({ ...ctx, bash })) as string
    expect(out).toContain('4 hours')
  })

  it('forwards conversationId to getLastActivityTime', async () => {
    let captured = ''
    const m = createIdleResumptionContributor({
      conversationId: 'conv_xyz',
      thresholdMs: THRESHOLD,
      getLastActivityTime: async (id) => {
        captured = id
        return null
      },
    })
    await m.contribute({ ...ctx, bash })
    expect(captured).toBe('conv_xyz')
  })

  it('uses priority 90 (below restart-recovery, above baseline)', () => {
    const m = createIdleResumptionContributor({
      conversationId: 'conv_1',
      thresholdMs: THRESHOLD,
      getLastActivityTime: async () => null,
    })
    expect(m.priority).toBe(90)
    expect(m.kind).toBe('custom')
  })
})
