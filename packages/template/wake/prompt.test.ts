import { describe, expect, it } from 'bun:test'
import { Bash, InMemoryFs } from 'just-bash'

import { resolvePlatformHint } from './platform-hints'
import { buildActiveIdsPreamble, buildFrozenPrompt, type SessionContext } from './prompt'

describe('buildActiveIdsPreamble', () => {
  it('renders the conversational form when contactId + channelInstanceId are present', () => {
    const line = buildActiveIdsPreamble({
      agentId: 'a_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
    })
    expect(line).toBe(
      'You are /agents/a_test/, conversing with /contacts/c_test/ via /contacts/c_test/ci_test/. Latest at /contacts/c_test/ci_test/messages.md.',
    )
  })

  it('renders the agent-only form when contactId is absent', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test', channelInstanceId: 'ci_test' })
    expect(line).toBe('You are /agents/a_test/.')
  })

  it('renders the agent-only form when channelInstanceId is absent', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test', contactId: 'c_test' })
    expect(line).toBe('You are /agents/a_test/.')
  })

  it('renders the agent-only form when both optional ids are absent', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test' })
    expect(line).toBe('You are /agents/a_test/.')
  })

  it('never emits empty-slot interpolation artifacts', () => {
    const line = buildActiveIdsPreamble({ agentId: 'a_test' })
    expect(line).not.toContain('undefined')
    expect(line).not.toContain('<none>')
    expect(line).not.toContain('//')
  })

  it('does not reference /conversations/ anywhere in the final form', () => {
    const full = buildActiveIdsPreamble({ agentId: 'a_test', contactId: 'c_test', channelInstanceId: 'ci_test' })
    expect(full).not.toContain('/conversations/')
  })
})

describe('buildFrozenPrompt session-context + platform-hints', () => {
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function buildBash() {
    const fs = new InMemoryFs()
    return new Bash({ fs })
  }

  const agentDefinition = {
    id: 'a_test',
    organizationId: 'org_test',
    name: 'Test Agent',
    slug: 'test-agent',
    model: 'gpt-4o',
    instructions: 'Be helpful.',
    workingMemory: '',
    scorerConfig: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never

  const fullCtx: SessionContext = {
    channelKind: 'whatsapp',
    channelLabel: 'Support WA',
    contactDisplayName: 'Alice',
    contactIdentifier: '+6598765432',
    staffAssigneeDisplayName: null,
    conversationStatus: 'active',
    customerSince: new Date('2025-11-03T00:00:00Z'),
  }

  it('renders a populated session-context block when ctx is supplied', async () => {
    const bash = await buildBash()
    const { system } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
      sessionContext: fullCtx,
      platformHint: resolvePlatformHint('whatsapp'),
    })
    expect(system).toContain('## Session context')
    expect(system).toContain('Channel: whatsapp (Support WA)')
    expect(system).toContain('Contact: Alice <+6598765432>')
    expect(system).toContain('Staff assignee: unassigned')
    expect(system).toContain('Conversation status: active')
    expect(system).toContain('Customer since: 2025-11-03')
  })

  it('renders a WhatsApp platform-hint section with medium-specific guidance', async () => {
    const bash = await buildBash()
    const { system } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
      sessionContext: fullCtx,
      platformHint: resolvePlatformHint('whatsapp'),
    })
    expect(system).toContain('## Platform hints')
    expect(system).toContain('24-hour session window')
    expect(system).toContain('markdown asterisks/backticks render literally')
  })

  it('falls back gracefully when session context + platform hint are absent', async () => {
    const bash = await buildBash()
    const { system } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
    })
    expect(system).toContain('## Session context')
    expect(system).toContain('_No session context resolved for this wake._')
    expect(system).toContain('## Platform hints')
    expect(system).toContain('_No channel-specific guidance available._')
  })

  it('produces a stable hash when the same inputs are re-rendered', async () => {
    const bash = await buildBash()
    const hint = resolvePlatformHint('whatsapp')
    const run = () =>
      buildFrozenPrompt({
        bash,
        agentDefinition,
        organizationId: 'org_test',
        contactId: 'c_test',
        channelInstanceId: 'ci_test',
        sessionContext: fullCtx,
        platformHint: hint,
      })
    const a = await run()
    const b = await run()
    expect(a.systemHash).toBe(b.systemHash)
  })

  it('renders sessionContext fields identically across known/unknown channels so the section is structurally stable', async () => {
    const bash = await buildBash()
    const base = { ...fullCtx, channelKind: 'web', channelLabel: null } satisfies SessionContext
    const { system } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
      sessionContext: base,
      platformHint: resolvePlatformHint('web'),
    })
    expect(system).toContain('Channel: web')
    expect(system).not.toContain('Channel: web (')
    expect(system).toContain('markdown is rendered')
  })
})

describe('buildFrozenPrompt regions', () => {
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function buildBash() {
    const fs = new InMemoryFs()
    return new Bash({ fs })
  }

  const agentDefinition = {
    id: 'a_test',
    organizationId: 'org_test',
    name: 'Test Agent',
    slug: 'test-agent',
    model: 'gpt-4o',
    instructions: 'Be helpful.',
    workingMemory: '',
    scorerConfig: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never

  it('returns a region per section, in render order, covering the full system string with `\\n\\n` gaps', async () => {
    const bash = await buildBash()
    const { system, regions } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
    })
    expect(regions.map((r) => r.source)).toEqual([
      'preamble',
      'system-ids',
      'session-context',
      'platform-hint',
      'memory-md',
      'agents-md',
      'business-md',
      'skills-list',
      'static-instructions',
    ])
    // Every region's slice matches its section content; consecutive regions
    // are separated by exactly two newlines (the section separator).
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]
      expect(r.start).toBeLessThan(r.end)
      expect(system.slice(r.start, r.end).length).toBe(r.end - r.start)
      if (i > 0) {
        const prev = regions[i - 1]
        expect(system.slice(prev.end, r.start)).toBe('\n\n')
      }
    }
    // First region starts at 0; last region's end equals total length.
    expect(regions[0].start).toBe(0)
    expect(regions[regions.length - 1].end).toBe(system.length)
  })

  it('the preamble region matches buildActiveIdsPreamble output', async () => {
    const bash = await buildBash()
    const { system, regions } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
    })
    const preambleRegion = regions.find((r) => r.source === 'preamble')
    expect(preambleRegion).toBeDefined()
    expect(system.slice(preambleRegion?.start, preambleRegion?.end)).toBe(
      'You are /agents/a_test/, conversing with /contacts/c_test/ via /contacts/c_test/ci_test/. Latest at /contacts/c_test/ci_test/messages.md.',
    )
  })

  it('the agents-md region begins with `## AGENTS.md` heading', async () => {
    const bash = await buildBash()
    const { system, regions } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
    })
    const r = regions.find((x) => x.source === 'agents-md')
    expect(r).toBeDefined()
    expect(system.slice(r?.start, r?.end)).toMatch(/^## AGENTS\.md\n\n/)
  })
})

describe('buildFrozenPrompt memory-bearing systemHash stability', () => {
  // Independent FS per call — fresh InMemoryFs + Bash + identical pre-population.
  // Verifies the determinism guard end-to-end through the real buildFrozenPrompt
  // pipeline (Step 8 of memory-hygiene-revised.md).
  async function runWithMemoryFixtures(): Promise<{ system: string; systemHash: string }> {
    const fs = new InMemoryFs()
    const bash = new Bash({ fs })
    const agentBudget = '<!-- memory-budget scope=agent id=a_test chars=42 (utf16) cap=8000 over=false -->\n'
    const contactBudget = '<!-- memory-budget scope=contact id=c_test chars=20 (utf16) cap=8000 over=false -->\n'
    const staffBudget = '<!-- memory-budget scope=staff id=u_a chars=15 (utf16) cap=8000 over=false -->\n'
    const agentsMd = [
      '## AGENTS.md',
      '',
      'Reference echoes of materializer outputs so the test can verify all three',
      'scope-budget headers reach the rendered system prompt:',
      '',
      contactBudget.trimEnd(),
      staffBudget.trimEnd(),
    ].join('\n')
    const agentMemoryBody = `${agentBudget}# Memory\n\n- always lead with price\n`
    await bash.fs.mkdir('/agents/a_test', { recursive: true })
    await bash.fs.writeFile('/agents/a_test/AGENTS.md', agentsMd)
    await bash.fs.writeFile('/agents/a_test/MEMORY.md', agentMemoryBody)
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
    } as never
    const { system, systemHash } = await buildFrozenPrompt({
      bash,
      agentDefinition,
      organizationId: 'org_test',
      contactId: 'c_test',
      channelInstanceId: 'ci_test',
      sessionContext: {
        channelKind: 'whatsapp',
        channelLabel: 'Support WA',
        contactDisplayName: 'Alice',
        contactIdentifier: '+6598765432',
        staffAssigneeDisplayName: null,
        conversationStatus: 'active',
        customerSince: new Date('2025-11-03T00:00:00Z'),
      },
      platformHint: resolvePlatformHint('whatsapp'),
    })
    return { system, systemHash }
  }

  it('systemHash is stable across two cold buildFrozenPrompt calls when memory bodies are materialized for all three scopes', async () => {
    const a = await runWithMemoryFixtures()
    const b = await runWithMemoryFixtures()
    expect(a.systemHash).toBe(b.systemHash)
  })

  it('all three scope-budget headers reach the rendered system prompt', async () => {
    const { system } = await runWithMemoryFixtures()
    expect(system).toContain('<!-- memory-budget scope=agent')
    expect(system).toContain('<!-- memory-budget scope=contact')
    expect(system).toContain('<!-- memory-budget scope=staff')
  })

  it('agent scope-budget header precedes the AGENTS.md region (memory-md region renders first)', async () => {
    const { system } = await runWithMemoryFixtures()
    const agentIdx = system.indexOf('<!-- memory-budget scope=agent')
    const agentsMdIdx = system.indexOf('## AGENTS.md')
    expect(agentIdx).toBeGreaterThanOrEqual(0)
    expect(agentsMdIdx).toBeGreaterThanOrEqual(0)
    expect(agentIdx).toBeLessThan(agentsMdIdx)
  })
})

describe('resolvePlatformHint', () => {
  it('returns undefined for unknown / null kinds', () => {
    expect(resolvePlatformHint(null)).toBeUndefined()
    expect(resolvePlatformHint(undefined)).toBeUndefined()
    expect(resolvePlatformHint('carrier-pigeon')).toBeUndefined()
  })

  it('returns a typed hint for each registered channel adapter', () => {
    for (const kind of ['web', 'whatsapp']) {
      const hint = resolvePlatformHint(kind)
      expect(hint).toBeDefined()
      expect(hint?.kind).toBe(kind)
      expect(hint?.hint.length).toBeGreaterThan(0)
    }
  })
})
