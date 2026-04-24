import { describe, expect, it, mock } from 'bun:test'

import { spillToFile } from './tool-budget-spill'
import { L1_PREVIEW_BYTES } from './turn-budget'
import type { ToolContext, ToolResultPersistedEvent } from './types'

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: 'org_1',
    conversationId: 'conv_1',
    wakeId: 'wake_1',
    agentId: 'agent_1',
    turnIndex: 3,
    toolCallId: 'tc_1',
    ...overrides,
  }
}

describe('spillToFile', () => {
  it('writes stdout, returns truncated preview, emits event with byte length', async () => {
    const stdout = 'x'.repeat(L1_PREVIEW_BYTES + 5_000)
    const innerWrite = mock(async (_p: string, _c: string) => {})
    const events: ToolResultPersistedEvent[] = []

    const out = await spillToFile({
      stdout,
      spillPath: '/tmp/out.txt',
      toolName: 'bash',
      ctx: makeCtx(),
      innerWrite,
      onSpill: (ev) => events.push(ev),
    })

    expect(out.preview).toHaveLength(L1_PREVIEW_BYTES)
    expect(out.preview).toBe(stdout.slice(0, L1_PREVIEW_BYTES))
    expect(out.byteLength).toBe(Buffer.byteLength(stdout, 'utf8'))
    expect(out.persisted).toEqual({
      path: '/tmp/out.txt',
      size: out.byteLength,
      preview: out.preview,
    })

    expect(innerWrite).toHaveBeenCalledTimes(1)
    expect(innerWrite.mock.calls[0]).toEqual(['/tmp/out.txt', stdout])

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_result_persisted',
      path: '/tmp/out.txt',
      toolName: 'bash',
      originalByteLength: out.byteLength,
      wakeId: 'wake_1',
      conversationId: 'conv_1',
      organizationId: 'org_1',
      turnIndex: 3,
      toolCallId: 'tc_1',
    })
    expect(events[0].ts).toBeInstanceOf(Date)
  })

  it('counts bytes, not characters, for multi-byte utf8', async () => {
    const stdout = '🔥'.repeat(10) // 4 bytes * 10 = 40 bytes
    const events: ToolResultPersistedEvent[] = []
    const out = await spillToFile({
      stdout,
      spillPath: '/tmp/emoji.txt',
      toolName: 'bash',
      ctx: makeCtx(),
      innerWrite: async () => {},
      onSpill: (ev) => events.push(ev),
    })
    expect(out.byteLength).toBe(40)
    expect(events[0].originalByteLength).toBe(40)
  })

  it('still returns preview + emits event when innerWrite throws', async () => {
    const events: ToolResultPersistedEvent[] = []
    const out = await spillToFile({
      stdout: 'hello',
      spillPath: '/tmp/fail.txt',
      toolName: 'bash',
      ctx: makeCtx(),
      innerWrite: async () => {
        throw new Error('disk full')
      },
      onSpill: (ev) => events.push(ev),
    })
    expect(out.preview).toBe('hello')
    expect(out.byteLength).toBe(5)
    expect(events).toHaveLength(1)
  })

  it('returns stdout verbatim in preview when it fits under L1', async () => {
    const stdout = 'short output'
    const out = await spillToFile({
      stdout,
      spillPath: '/tmp/small.txt',
      toolName: 'bash',
      ctx: makeCtx(),
      innerWrite: async () => {},
      onSpill: () => {},
    })
    expect(out.preview).toBe(stdout)
  })
})
