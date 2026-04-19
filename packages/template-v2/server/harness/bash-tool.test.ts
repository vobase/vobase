import { describe, expect, it } from 'bun:test'
import type { ToolResultPersistedEvent } from '@server/contracts/event'
import type { ToolExecutionContext } from '@server/contracts/plugin-context'
import { Bash, InMemoryFs } from 'just-bash'
import { BASH_PREVIEW_BYTES, makeBashTool } from './bash-tool'
import { L1_PREVIEW_BYTES, L2_SPILL_BYTES, L3_CEILING_BYTES, TurnBudget } from './turn-budget'

const TOOL_CTX: ToolExecutionContext = {
  tenantId: 't',
  conversationId: 'c',
  wakeId: 'w',
  agentId: 'a',
  turnIndex: 0,
  toolCallId: 'call-1',
}

function makeCtx(toolCallId: string): ToolExecutionContext {
  return { ...TOOL_CTX, toolCallId }
}

describe('bash tool', () => {
  it('wraps a simple command', async () => {
    const fs = new InMemoryFs()
    await fs.writeFile('/hello.txt', 'world')
    const bash = new Bash({ fs })
    const tool = makeBashTool({ bash, innerWrite: async (p, c) => fs.writeFile(p, c) })
    const r = await tool.execute({ command: 'cat /hello.txt' }, TOOL_CTX)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.stdout).toBe('world')
  })

  it('BASH_PREVIEW_BYTES equals L1_PREVIEW_BYTES', () => {
    expect(BASH_PREVIEW_BYTES).toBe(L1_PREVIEW_BYTES)
  })

  it('returns an error envelope on missing command', async () => {
    const fs = new InMemoryFs()
    const bash = new Bash({ fs })
    const tool = makeBashTool({ bash, innerWrite: async () => {} })
    const r = await tool.execute({} as unknown as { command: string }, TOOL_CTX)
    expect(r.ok).toBe(false)
  })

  // ── Layer 2 (individual spill threshold) ────────────────────────────────────

  it('50 KB output passes through unchanged (under L2 threshold)', async () => {
    const fs = new InMemoryFs()
    const content = 'x'.repeat(50_000)
    await fs.writeFile('/medium.txt', content)
    const bash = new Bash({ fs })
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      onSpill: (ev) => spills.push(ev),
    })
    const r = await tool.execute({ command: 'cat /medium.txt' }, TOOL_CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.content.stdout).toBe(content)
    expect(r.persisted).toBeUndefined()
    expect(spills).toHaveLength(0)
  })

  it('150 KB output spills to /workspace/tmp/, emits ToolResultPersistedEvent, preview ≤ L1', async () => {
    const fs = new InMemoryFs()
    const big = 'y'.repeat(150_000)
    await fs.writeFile('/big.txt', big)
    const bash = new Bash({ fs })
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      onSpill: (ev) => spills.push(ev),
    })
    const r = await tool.execute({ command: 'cat /big.txt' }, makeCtx('call-big'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.persisted).toBeDefined()
    expect(r.persisted?.path).toBe('/workspace/tmp/tool-call-big.txt')
    expect(r.persisted?.size).toBe(150_000)
    expect(r.content.stdout.length).toBeLessThanOrEqual(L1_PREVIEW_BYTES)
    expect(spills).toHaveLength(1)
    expect(spills[0]?.type).toBe('tool_result_persisted')
    expect(spills[0]?.path).toBe('/workspace/tmp/tool-call-big.txt')
    expect(spills[0]?.originalByteLength).toBe(150_000)
  })

  // ── Layer 3 (turn-aggregate ceiling) ────────────────────────────────────────

  it('turn aggregate > L3_CEILING_BYTES force-spills subsequent results', async () => {
    const fs = new InMemoryFs()
    // First call: 130 KB → L2 spill (>100 KB). Budget: 130 KB.
    // Second call: 90 KB → individually under L2, but budget = 220 KB > 200 KB → L3 force-spill.
    const chunk1 = 'a'.repeat(130_000)
    const chunk2 = 'b'.repeat(90_000)
    await fs.writeFile('/chunk1.txt', chunk1)
    await fs.writeFile('/chunk2.txt', chunk2)
    const bash = new Bash({ fs })
    const budget = new TurnBudget()
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      turnBudget: budget,
      onSpill: (ev) => spills.push(ev),
    })
    const r1 = await tool.execute({ command: 'cat /chunk1.txt' }, makeCtx('call-c1'))
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.persisted).toBeDefined() // L2 spill

    const r2 = await tool.execute({ command: 'cat /chunk2.txt' }, makeCtx('call-c2'))
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.persisted).toBeDefined() // L3 force-spill
    expect(spills).toHaveLength(2)
    expect(spills[1]?.path).toBe('/workspace/tmp/tool-call-c2.txt')
  })

  // ── Path-based exemption ────────────────────────────────────────────────────

  it('cat of a spill file does not re-spill (path exemption)', async () => {
    const fs = new InMemoryFs()
    const spillContent = 'z'.repeat(L2_SPILL_BYTES + 1)
    // Pre-write the spill file so `cat` returns it.
    await fs.writeFile('/workspace/tmp/tool-prev.txt', spillContent)
    const bash = new Bash({ fs })
    const budget = new TurnBudget()
    // Pre-fill budget past L3 ceiling to confirm exemption overrides it.
    budget.record(L3_CEILING_BYTES + 1)
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      turnBudget: budget,
      onSpill: (ev) => spills.push(ev),
    })
    const r = await tool.execute({ command: 'cat /workspace/tmp/tool-prev.txt' }, TOOL_CTX)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.persisted).toBeUndefined() // no re-spill
    expect(spills).toHaveLength(0)
  })

  it('bash -c "head /workspace/tmp/tool-*.txt" does not re-spill (subshell exemption)', async () => {
    const fs = new InMemoryFs()
    const spillContent = 'w'.repeat(L2_SPILL_BYTES + 1)
    await fs.writeFile('/workspace/tmp/tool-abc123.txt', spillContent)
    const bash = new Bash({ fs })
    const budget = new TurnBudget()
    budget.record(L3_CEILING_BYTES + 1)
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      turnBudget: budget,
      onSpill: (ev) => spills.push(ev),
    })
    const r = await tool.execute({ command: 'bash -c "head -n 5 /workspace/tmp/tool-abc123.txt"' }, TOOL_CTX)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.persisted).toBeUndefined()
    expect(spills).toHaveLength(0)
  })
})
