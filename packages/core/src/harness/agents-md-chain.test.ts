import { describe, expect, it } from 'bun:test'
import { InMemoryFs } from 'just-bash'

import { createAgentsMdChainContributor, deriveTouchedDirsFromBashHistory } from './agents-md-chain'
import type { SideLoadCtx } from './types'

const ctx = { organizationId: 'o', conversationId: 'c', turnIndex: 0 } as unknown as SideLoadCtx
const bash = { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } as unknown as Parameters<
  Awaited<ReturnType<typeof makeFs>>['exists']
>[0]

async function makeFs(files: Record<string, string>) {
  const fs = new InMemoryFs()
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/'
    if (dir !== '/') await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path, content)
  }
  return fs
}

describe('createAgentsMdChainContributor', () => {
  it('collects ancestor AGENTS.md files for a touched dir and formats them', async () => {
    const fs = await makeFs({
      '/drive/AGENTS.md': 'Top-level drive hint.',
      '/drive/policies/AGENTS.md': 'Policies hint.',
      '/drive/policies/billing/AGENTS.md': 'Billing-specific hint: verify invoice first.',
    })
    const m = createAgentsMdChainContributor({
      touchedDirsProvider: () => ['/drive/policies/billing'],
      fs,
    })
    const out = (await m.contribute({ ...ctx, bash } as never)) as string
    expect(out).toContain('## Context hints')
    expect(out).toContain('### /drive/policies/billing/AGENTS.md')
    expect(out).toContain('### /drive/policies/AGENTS.md')
    expect(out).toContain('### /drive/AGENTS.md')
    expect(out).toContain('Billing-specific hint')
  })

  it('returns empty when no AGENTS.md in the chain', async () => {
    const fs = await makeFs({})
    const m = createAgentsMdChainContributor({
      touchedDirsProvider: () => ['/drive/policies/billing'],
      fs,
    })
    const out = await m.contribute({ ...ctx, bash } as never)
    expect(out).toBe('')
  })

  it('dedupes files across multiple touched dirs and consecutive turns', async () => {
    const fs = await makeFs({
      '/drive/policies/AGENTS.md': 'Policies hint.',
    })
    const m = createAgentsMdChainContributor({
      touchedDirsProvider: () => ['/drive/policies/billing', '/drive/policies/refunds'],
      fs,
    })
    const first = (await m.contribute({ ...ctx, bash } as never)) as string
    expect(first).toContain('/drive/policies/AGENTS.md')
    // Same ancestor surfaces only once in the first emission.
    expect((first.match(/### \/drive\/policies\/AGENTS\.md/g) ?? []).length).toBe(1)
    // Second turn: same dirs, already-emitted files don't re-inject.
    const second = await m.contribute({ ...ctx, bash } as never)
    expect(second).toBe('')
  })

  it('ignores paths in ignorePaths', async () => {
    const fs = await makeFs({
      '/agents/a_xyz/AGENTS.md': 'already in system prompt — skip',
      '/drive/AGENTS.md': 'drive hint',
    })
    const m = createAgentsMdChainContributor({
      touchedDirsProvider: () => ['/agents/a_xyz', '/drive'],
      fs,
      ignorePaths: ['/agents/a_xyz/AGENTS.md'],
    })
    const out = (await m.contribute({ ...ctx, bash } as never)) as string
    expect(out).toContain('/drive/AGENTS.md')
    expect(out).not.toContain('/agents/a_xyz/AGENTS.md')
  })

  it('respects rootStop by not walking above the stop prefix', async () => {
    const fs = await makeFs({
      '/AGENTS.md': 'root level — should be skipped',
      '/drive/AGENTS.md': 'drive level',
      '/drive/policies/AGENTS.md': 'policies level',
    })
    const m = createAgentsMdChainContributor({
      touchedDirsProvider: () => ['/drive/policies'],
      fs,
      rootStop: '/drive',
    })
    const out = (await m.contribute({ ...ctx, bash } as never)) as string
    expect(out).toContain('/drive/policies/AGENTS.md')
    expect(out).toContain('/drive/AGENTS.md')
    expect(out).not.toContain('root level')
  })

  it('truncates at maxBytes to avoid prompt blowup', async () => {
    const bigBody = 'x'.repeat(1000)
    const fs = await makeFs({
      '/a/AGENTS.md': bigBody,
      '/a/b/AGENTS.md': bigBody,
      '/a/b/c/AGENTS.md': bigBody,
    })
    const m = createAgentsMdChainContributor({
      touchedDirsProvider: () => ['/a/b/c'],
      fs,
      maxBytes: 1500,
    })
    const out = (await m.contribute({ ...ctx, bash } as never)) as string
    // Deepest-first: /a/b/c fits, /a/b is next (would overflow), /a skipped.
    expect(out).toContain('### /a/b/c/AGENTS.md')
    expect(out.split('### ').length - 1).toBe(1)
  })

  it('uses priority 50', () => {
    const fs = new InMemoryFs()
    const m = createAgentsMdChainContributor({ touchedDirsProvider: () => [], fs })
    expect(m.priority).toBe(50)
  })
})

describe('deriveTouchedDirsFromBashHistory', () => {
  it('extracts dirs from read verbs with absolute paths', () => {
    const dirs = deriveTouchedDirsFromBashHistory([
      'cat /drive/policies/billing/refund.md',
      'ls /drive/policies',
      'grep -r "refund" /drive/policies/billing',
    ])
    expect(dirs).toContain('/drive/policies/billing')
    expect(dirs).toContain('/drive/policies')
  })

  it('extracts dirs from write verbs and redirections', () => {
    const dirs = deriveTouchedDirsFromBashHistory([
      'mkdir -p /tmp/work',
      'touch /tmp/work/out.txt',
      'echo hello > /contacts/c_abc/drive/note.md',
    ])
    expect(dirs).toContain('/tmp/work')
    expect(dirs).toContain('/contacts/c_abc/drive')
  })

  it('ignores commands without absolute paths', () => {
    const dirs = deriveTouchedDirsFromBashHistory(['pwd', 'ls', 'cd ..', 'echo hi'])
    expect(dirs).toEqual([])
  })

  it('splits compound commands', () => {
    const dirs = deriveTouchedDirsFromBashHistory(['cd /drive/policies && ls /drive/contracts'])
    expect(dirs).toContain('/drive/policies')
    expect(dirs).toContain('/drive/contracts')
  })
})
