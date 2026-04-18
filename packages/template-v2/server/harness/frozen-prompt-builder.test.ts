import { describe, expect, it } from 'bun:test'
import type { AgentDefinition } from '@server/contracts/domain-types'
import { Bash } from 'just-bash'
import { buildFrozenPrompt } from './frozen-prompt-builder'

const DEF: AgentDefinition = {
  id: 'agent-1',
  tenantId: 't1',
  name: 'a',
  soulMd: 'SOUL body',
  model: 'mock',
  maxSteps: 1,
  workingMemory: 'MEM body',
  skillAllowlist: null,
  cardApprovalRequired: false,
  fileApprovalRequired: false,
  bookSlotApprovalRequired: false,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

async function seeded(): Promise<Bash> {
  const bash = new Bash()
  await bash.writeFile('/workspace/AGENTS.md', 'AGENTS body')
  await bash.writeFile('/workspace/SOUL.md', 'SOUL body')
  await bash.writeFile('/workspace/MEMORY.md', 'MEM body')
  await bash.writeFile('/workspace/drive/BUSINESS.md', 'BIZ body')
  return bash
}

describe('buildFrozenPrompt', () => {
  it('includes all four frozen files + a hash', async () => {
    const bash = await seeded()
    const r = await buildFrozenPrompt({
      bash,
      agentDefinition: DEF,
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'k1',
    })
    expect(r.system).toContain('AGENTS body')
    expect(r.system).toContain('SOUL body')
    expect(r.system).toContain('MEM body')
    expect(r.system).toContain('BIZ body')
    expect(r.systemHash).toHaveLength(64)
    expect(r.systemHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hash is stable across identical inputs', async () => {
    const bash1 = await seeded()
    const bash2 = await seeded()
    const a = await buildFrozenPrompt({
      bash: bash1,
      agentDefinition: DEF,
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'k1',
    })
    const b = await buildFrozenPrompt({
      bash: bash2,
      agentDefinition: DEF,
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'k1',
    })
    expect(a.systemHash).toBe(b.systemHash)
  })

  it('hash changes when MEMORY.md changes', async () => {
    const bash = await seeded()
    const a = await buildFrozenPrompt({
      bash,
      agentDefinition: DEF,
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'k1',
    })
    await bash.writeFile('/workspace/MEMORY.md', 'CHANGED')
    const b = await buildFrozenPrompt({
      bash,
      agentDefinition: DEF,
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'k1',
    })
    expect(a.systemHash).not.toBe(b.systemHash)
  })
})
