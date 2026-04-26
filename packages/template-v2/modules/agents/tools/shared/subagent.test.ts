import { describe, expect, it } from 'bun:test'
import { createSubagentRunner } from '@modules/agents/service/subagent-runner'
import type { ToolContext } from '@vobase/core'

import { subagentTool } from './subagent'

function makeCtx(): ToolContext {
  return {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    wakeId: 'wake-1',
    agentId: 'agt-1',
    turnIndex: 0,
    toolCallId: 'tc-1',
  }
}

describe('subagentTool', () => {
  it('has stable name and no requiresApproval gate', () => {
    expect(subagentTool.name).toBe('subagent')
    expect(subagentTool.requiresApproval).toBeFalsy()
  })

  it('rejects empty goal', async () => {
    const result = await subagentTool.execute({ goal: '', toolset: [], maxTurns: 3 }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('rejects non-integer maxTurns', async () => {
    const result = await subagentTool.execute({ goal: 'do thing', toolset: [], maxTurns: 1.5 }, makeCtx())
    expect(result.ok).toBe(false)
  })

  it('rejects maxTurns > 10', async () => {
    const result = await subagentTool.execute({ goal: 'do thing', toolset: [], maxTurns: 11 }, makeCtx())
    expect(result.ok).toBe(false)
  })

  it('happy path returns summary', async () => {
    const result = await subagentTool.execute({ goal: 'summarise the conversation', toolset: ['reply'] }, makeCtx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.summary).toContain('summarise the conversation')
  })

  it('maxTurns defaults to 5 when omitted', async () => {
    const result = await subagentTool.execute({ goal: 'check order status', toolset: [] }, makeCtx())
    expect(result.ok).toBe(true)
  })
})

describe('createSubagentRunner depth limit', () => {
  it('depth=0 runner succeeds', async () => {
    const run = createSubagentRunner(0)
    const result = await run({ goal: 'fetch data', toolset: [], maxTurns: 2, ctx: makeCtx() })
    expect(result.ok).toBe(true)
  })

  it('depth=1 runner throws synchronously (second-level subagent)', async () => {
    const innerRun = createSubagentRunner(1)
    await expect(innerRun({ goal: 'nested goal', toolset: [], maxTurns: 2, ctx: makeCtx() })).rejects.toThrow(
      'max depth 1 exceeded',
    )
  })
})
