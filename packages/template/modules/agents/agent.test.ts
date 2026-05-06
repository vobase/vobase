import { describe, expect, it } from 'bun:test'
import type { AgentDefinition } from '@modules/agents/schema'
import { setCliRegistry } from '@modules/agents/service/cli-registry'
import { CliVerbRegistry, type IndexContributor, type MaterializerCtx, type WorkspaceMaterializer } from '@vobase/core'

import type { WakeContext } from '~/wake/context'
import { agentsAgentsMdContributors, agentsMaterializerFactory, MEMORY_CAPTURE_TRIGGERS } from './agent'

setCliRegistry(new CliVerbRegistry())

const BANNED_IDENTIFIERS: readonly RegExp[] = [
  /\bDate\b/,
  /\bDate\.now\b/,
  /Math\.random/,
  /crypto\.randomUUID/,
  /process\.env/,
  /Bun\.env/,
  /import\.meta\.env/,
  /os\.hostname/,
  /process\.version/,
  /performance\.now/,
  /__dirname/,
  /__filename/,
]

function makeWakeCtx(overrides: Partial<WakeContext> = {}): WakeContext {
  const agentDefinition = {
    id: 'a_test',
    organizationId: 'org_test',
    name: 'Test Agent',
    slug: 'test-agent',
    model: 'gpt-4o',
    instructions: 'Be helpful.',
    workingMemory: '',
    scorerConfig: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as AgentDefinition
  return {
    organizationId: 'org_test',
    agentId: 'a_test',
    contactId: 'c_test',
    channelInstanceId: 'ci_test',
    conversationId: 'conv_test',
    drive: {} as WakeContext['drive'],
    staffIds: [],
    budgetHeaderStaffIds: [],
    authLookup: {} as WakeContext['authLookup'],
    agentDefinition,
    tools: [],
    agentsMdContributors: [],
    lane: 'conversation',
    triggerKind: 'inbound_message',
    audienceTier: 'contact',
    ...overrides,
  } as WakeContext
}

const MAT_CTX: MaterializerCtx = {
  organizationId: 'org_test',
  agentId: 'a_test',
  conversationId: 'conv_test',
  contactId: 'c_test',
  turnIndex: 0,
}

async function runMaterializer(mat: WorkspaceMaterializer): Promise<string> {
  const out = await mat.materialize(MAT_CTX)
  return typeof out === 'string' ? out : ''
}

function renderContributor(c: IndexContributor): string {
  const out = c.render({} as never)
  return out ?? ''
}

describe('agent materializer header', () => {
  it('prepends a memory-budget header to /agents/<id>/MEMORY.md when memory is non-empty', async () => {
    const ctx = makeWakeCtx({
      agentDefinition: {
        ...makeWakeCtx().agentDefinition,
        workingMemory: '# Memory\n\n- always be polite\n',
      } as AgentDefinition,
    })
    const mats = agentsMaterializerFactory(ctx)
    const memMat = mats.find((m) => m.path === `/agents/${ctx.agentId}/MEMORY.md`)
    expect(memMat).toBeDefined()
    if (!memMat) return
    const out = await runMaterializer(memMat)
    expect(out).toMatch(
      /^<!-- memory-budget scope=agent id=a_test chars=\d+ \(utf16\) cap=8000 over=(true|false) -->\n/,
    )
    expect(out).toContain('always be polite')
  })

  it('still emits the header for empty memory (chars=0 over=false)', async () => {
    const ctx = makeWakeCtx()
    const mats = agentsMaterializerFactory(ctx)
    const memMat = mats.find((m) => m.path === `/agents/${ctx.agentId}/MEMORY.md`)
    expect(memMat).toBeDefined()
    if (!memMat) return
    const out = await runMaterializer(memMat)
    expect(out.startsWith('<!-- memory-budget scope=agent id=a_test chars=')).toBe(true)
    expect(out).toContain('cap=8000')
  })

  it('two same-input calls produce byte-identical output', async () => {
    const ctx = makeWakeCtx({
      agentDefinition: {
        ...makeWakeCtx().agentDefinition,
        workingMemory: '# Memory\n\n- be deterministic\n',
      } as AgentDefinition,
    })
    const mats1 = agentsMaterializerFactory(ctx)
    const mats2 = agentsMaterializerFactory(ctx)
    const m1 = mats1.find((m) => m.path === `/agents/${ctx.agentId}/MEMORY.md`)
    const m2 = mats2.find((m) => m.path === `/agents/${ctx.agentId}/MEMORY.md`)
    expect(m1 && m2).toBeTruthy()
    if (!m1 || !m2) return
    const a = await runMaterializer(m1)
    const b = await runMaterializer(m2)
    expect(a).toBe(b)
  })
})

describe('agents.ts source determinism', () => {
  it('source determinism — modules/agents/agent.ts contains no banned identifiers', async () => {
    const source = await Bun.file(`${import.meta.dir}/agent.ts`).text()
    for (const banned of BANNED_IDENTIFIERS) {
      expect(source).not.toMatch(banned)
    }
  })
})

function findContributor(name: string) {
  const c = agentsAgentsMdContributors.find((x) => x.name === name)
  if (!c) throw new Error(`contributor not found: ${name}`)
  return c
}

describe('agents.memory-capture-triggers contributor', () => {
  it('priority 25, name agents.memory-capture-triggers', () => {
    const c = findContributor('agents.memory-capture-triggers')
    expect(c.priority).toBe(25)
  })

  it('renders exactly one `## ` heading and stays within pinned body-length bounds', () => {
    const c = findContributor('agents.memory-capture-triggers')
    const render = renderContributor(c)
    expect(render.match(/^## /gm)?.length).toBe(1)
    expect(render.length).toBeGreaterThanOrEqual(850)
    expect(render.length).toBeLessThanOrEqual(1450)
  })

  it('contains every MEMORY_CAPTURE_TRIGGERS keyword word-bounded', () => {
    const c = findContributor('agents.memory-capture-triggers')
    const render = renderContributor(c)
    for (const kw of MEMORY_CAPTURE_TRIGGERS) {
      const safe = kw.replace(/ /g, '\\s')
      expect(render).toMatch(new RegExp(`\\b${safe}\\b`, 'i'))
    }
  })

  it('explicitly references the auto-loop reframe (do NOT echo staff signals)', () => {
    const c = findContributor('agents.memory-capture-triggers')
    const render = renderContributor(c)
    expect(render).toMatch(/auto-loop|self-learn loop/i)
    expect(render).toMatch(/Staff signal/)
  })
})

describe('agents.memory-conventions contributor', () => {
  it('priority 26, name agents.memory-conventions', () => {
    const c = findContributor('agents.memory-conventions')
    expect(c.priority).toBe(26)
  })

  it('renders exactly two `## ` headings and stays within pinned body-length bounds', () => {
    const c = findContributor('agents.memory-conventions')
    const render = renderContributor(c)
    // Two headings: `## Memory scopes` (mutation playbook) and
    // `## Structured fields vs prose memory` (frontmatter capture triggers).
    expect(render.match(/^## /gm)?.length).toBe(2)
    expect(render.length).toBeGreaterThanOrEqual(1075)
    expect(render.length).toBeLessThanOrEqual(2900)
  })

  it('renders all three scope rows exactly once', () => {
    const c = findContributor('agents.memory-conventions')
    const render = renderContributor(c)
    expect((render.match(/^\| agent \|/gm) ?? []).length).toBe(1)
    expect((render.match(/^\| contact \|/gm) ?? []).length).toBe(1)
    expect((render.match(/^\| staff \|/gm) ?? []).length).toBe(1)
  })

  it('mentions propose_contact_attribute and the follow-up plan name', () => {
    const c = findContributor('agents.memory-conventions')
    const render = renderContributor(c)
    expect(render).toContain('propose_contact_attribute')
    expect(render).toContain('memory-contact-attribute-confidence')
  })

  it('teaches the profile.md frontmatter vs MEMORY.md prose split', () => {
    const c = findContributor('agents.memory-conventions')
    const render = renderContributor(c)
    expect(render).toMatch(/profile\.md.*frontmatter/)
    expect(render).toMatch(/auto-rendered/)
    expect(render).toMatch(/Customer-volunteered facts/)
    expect(render).toMatch(/Staff-volunteered facts/)
    expect(render).toMatch(/High-confidence inferences/)
  })
})

describe('agents.self-state contributor (post-trim)', () => {
  it('renders exactly one `## ` heading and stays within pinned body-length bounds', () => {
    const c = findContributor('agents.self-state')
    const render = renderContributor(c)
    expect(render.match(/^## /gm)?.length).toBe(1)
    expect(render.length).toBeGreaterThanOrEqual(200)
    expect(render.length).toBeLessThanOrEqual(900)
  })

  it('does NOT carry the When-to-capture heading or capture-imperative phrasing', () => {
    const c = findContributor('agents.self-state')
    const render = renderContributor(c)
    expect(render).not.toMatch(/^## When to capture/m)
    expect(render).not.toMatch(/(\balways do\b|\bnever forget\b|\bfrom now on\b|\bremember that\b)/i)
  })
})

describe('contributor priority order', () => {
  it('agents.self-state (20) → memory-capture-triggers (25) → memory-conventions (26)', () => {
    const order = agentsAgentsMdContributors
      .filter((c): c is typeof c & { name: string } => typeof c.name === 'string' && c.name.startsWith('agents.'))
      .sort((a, b) => a.priority - b.priority)
      .map((c) => c.name)
    const idxSelfState = order.indexOf('agents.self-state')
    const idxCapture = order.indexOf('agents.memory-capture-triggers')
    const idxConv = order.indexOf('agents.memory-conventions')
    expect(idxSelfState).toBeGreaterThanOrEqual(0)
    expect(idxCapture).toBeGreaterThan(idxSelfState)
    expect(idxConv).toBeGreaterThan(idxCapture)
  })
})
