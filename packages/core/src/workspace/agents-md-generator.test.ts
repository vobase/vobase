import { describe, expect, it } from 'bun:test'

import { type AgentsMdCommand, type AgentsMdTool, generateAgentsMd } from './agents-md-generator'
import { defineIndexContributor } from './index-file-builder'

function cmd(name: string, description: string, usage?: string): AgentsMdCommand {
  return { name, description, usage }
}

const BASE = {
  agentName: 'Test Agent',
  agentId: 'a_test',
  instructions: 'Be helpful.',
} as const

describe('generateAgentsMd', () => {
  it('renders title line with agentName + agentId', () => {
    const md = generateAgentsMd({ ...BASE, commands: [] })
    expect(md.split('\n')[0]).toBe('# Test Agent (a_test)')
  })

  it('renders commands in alphabetical order', () => {
    const md = generateAgentsMd({
      ...BASE,
      commands: [cmd('reply', 'Send a reply.'), cmd('drive ls', 'List drive.'), cmd('hold', 'Put on hold.')],
    })
    const commandsSection = md.slice(md.indexOf('## Commands'))
    const reply = commandsSection.indexOf('vobase reply')
    const drive = commandsSection.indexOf('vobase drive ls')
    const hold = commandsSection.indexOf('vobase hold')
    expect(hold).toBeGreaterThan(-1)
    expect(drive).toBeGreaterThan(-1)
    expect(reply).toBeGreaterThan(-1)
    // alphabetical: drive ls < hold < reply
    expect(drive).toBeLessThan(hold)
    expect(hold).toBeLessThan(reply)
  })

  it('emits a generic framework preamble + commands section by default', () => {
    const md = generateAgentsMd({ ...BASE, commands: [] })
    // Default header is generic — no helpdesk-specific layout. Platforms layer
    // their own header text via `headerOverride`.
    expect(md).toContain('virtual workspace')
    expect(md).toContain('## Commands')
    expect(md).toContain('_No commands registered._')
  })

  it('renders headerOverride verbatim instead of the generic default', () => {
    const md = generateAgentsMd({
      ...BASE,
      commands: [],
      headerOverride: '## Layout\n\n- `/agents/<id>/MEMORY.md` — your working memory',
    })
    expect(md).toContain('## Layout')
    expect(md).toContain('your working memory')
    // Generic default must not also be rendered.
    expect(md).not.toContain('Direct writes are blocked outside the writable zones')
  })

  it('emits Instructions section with verbatim body', () => {
    const md = generateAgentsMd({
      ...BASE,
      instructions: 'Line one.\n\nLine two — with punctuation!',
      commands: [],
    })
    expect(md).toContain('## Instructions')
    expect(md).toContain('Line one.\n\nLine two — with punctuation!')
  })

  it('falls back to empty-state body when instructions are blank', () => {
    const md = generateAgentsMd({ ...BASE, instructions: '   ', commands: [] })
    expect(md).toContain('_No instructions authored yet._')
  })

  it('never emits legacy SOUL.md / TOOLS.md / bookings.md / /workspace/ substrings', () => {
    const md = generateAgentsMd({
      ...BASE,
      commands: [cmd('reply', 'Send a reply.')],
    })
    expect(md).not.toContain('SOUL.md')
    expect(md).not.toContain('TOOLS.md')
    expect(md).not.toContain('bookings.md')
    expect(md).not.toContain('/workspace/')
  })

  it('renders extraContributors at their declared priority, interleaved with built-ins', () => {
    // Built-in priorities: 0 title, 10 header, 100 commands, 150 tool-guidance, 200 instructions.
    // Extras at 20 (after header) and 175 (between tool-guidance and instructions) should land
    // in the right slots.
    const md = generateAgentsMd({
      ...BASE,
      commands: [],
      extraContributors: [
        defineIndexContributor({
          file: 'AGENTS.md',
          priority: 20,
          name: 'self-state',
          render: () => '## Self-state',
        }),
        defineIndexContributor({
          file: 'AGENTS.md',
          priority: 175,
          name: 'policies',
          render: () => '## Policies',
        }),
      ],
    })
    const titleIdx = md.indexOf('# Test Agent')
    const selfIdx = md.indexOf('## Self-state')
    const commandsIdx = md.indexOf('## Commands')
    const policiesIdx = md.indexOf('## Policies')
    const instructionsIdx = md.indexOf('## Instructions')
    expect(titleIdx).toBeGreaterThan(-1)
    expect(selfIdx).toBeGreaterThan(titleIdx)
    expect(commandsIdx).toBeGreaterThan(selfIdx)
    expect(policiesIdx).toBeGreaterThan(commandsIdx)
    expect(instructionsIdx).toBeGreaterThan(policiesIdx)
  })

  it('skips extraContributors that render null', () => {
    const md = generateAgentsMd({
      ...BASE,
      commands: [],
      extraContributors: [
        defineIndexContributor({
          file: 'AGENTS.md',
          priority: 25,
          name: 'never-renders',
          render: () => null,
        }),
      ],
    })
    expect(md).not.toContain('null')
    expect(md).not.toContain('never-renders')
  })

  it('renders Tool guidance section sorted by tool name when prompts present', () => {
    const tools: AgentsMdTool[] = [
      { name: 'reply', prompt: 'Use reply for plain text.' },
      { name: 'add_note', prompt: 'Use add_note to record an internal note.' },
      { name: 'send_card', prompt: 'Use send_card for structured choices.' },
    ]
    const md = generateAgentsMd({ ...BASE, commands: [], tools })
    const guidance = md.slice(md.indexOf('## Tool guidance'))
    const addNote = guidance.indexOf('add_note')
    const reply = guidance.indexOf('reply')
    const sendCard = guidance.indexOf('send_card')
    expect(addNote).toBeGreaterThan(-1)
    expect(addNote).toBeLessThan(reply)
    expect(reply).toBeLessThan(sendCard)
  })

  it('omits Tool guidance section when no tool carries a prompt', () => {
    const md = generateAgentsMd({
      ...BASE,
      commands: [],
      tools: [{ name: 'reply' }, { name: 'add_note', prompt: '   ' }],
    })
    expect(md).not.toContain('## Tool guidance')
  })

  it('contributors targeting INDEX.md do not leak into AGENTS.md output', () => {
    const md = generateAgentsMd({
      ...BASE,
      commands: [],
      extraContributors: [
        defineIndexContributor({
          file: 'INDEX.md',
          priority: 25,
          name: 'index-only',
          render: () => '## Should-not-appear',
        }),
      ],
    })
    expect(md).not.toContain('Should-not-appear')
  })

  it('produces byte-identical output across consecutive calls (frozen-snapshot stability)', () => {
    const opts = {
      ...BASE,
      commands: [cmd('reply', 'Send a reply.')],
      tools: [{ name: 'reply', prompt: 'Use reply for plain text.' }] as AgentsMdTool[],
      extraContributors: [
        defineIndexContributor({
          file: 'AGENTS.md',
          priority: 25,
          name: 'self-state',
          render: () => '## Self-state',
        }),
      ],
    }
    const a = generateAgentsMd(opts)
    const b = generateAgentsMd(opts)
    expect(a).toBe(b)
  })
})
