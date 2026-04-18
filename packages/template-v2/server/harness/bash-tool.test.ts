import { describe, expect, it } from 'bun:test'
import type { ToolExecutionContext } from '@server/contracts/plugin-context'
import { Bash, InMemoryFs } from 'just-bash'
import { BASH_PREVIEW_BYTES, makeBashTool } from './bash-tool'

const TOOL_CTX: ToolExecutionContext = {
  tenantId: 't',
  conversationId: 'c',
  wakeId: 'w',
  agentId: 'a',
  turnIndex: 0,
  toolCallId: 'call-1',
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

  it('spills oversized stdout to a tmp file + returns a preview', async () => {
    const fs = new InMemoryFs()
    const big = 'x'.repeat(BASH_PREVIEW_BYTES + 100)
    await fs.writeFile('/big.txt', big)
    const bash = new Bash({ fs })
    const tool = makeBashTool({ bash, innerWrite: async (p, c) => fs.writeFile(p, c) })
    const r = await tool.execute({ command: 'cat /big.txt' }, TOOL_CTX)
    if (!r.ok) throw new Error('expected ok')
    expect(r.persisted).toBeDefined()
    expect(r.persisted?.path).toBe('/workspace/tmp/tool-call-1.txt')
    expect(r.persisted?.size).toBe(big.length)
    // The preview is not empty and truncated at BASH_PREVIEW_BYTES.
    expect(r.content.stdout.length).toBeLessThanOrEqual(BASH_PREVIEW_BYTES)
  })

  it('returns an error envelope on missing command', async () => {
    const fs = new InMemoryFs()
    const bash = new Bash({ fs })
    const tool = makeBashTool({ bash, innerWrite: async () => {} })
    const r = await tool.execute({} as unknown as { command: string }, TOOL_CTX)
    expect(r.ok).toBe(false)
  })
})
