import { describe, expect, it } from 'bun:test'

import type { CommandDef } from '../harness/types'
import { generateAgentsMd } from './agents-md-generator'

function cmd(name: string, description: string, usage?: string): CommandDef {
  return {
    name,
    description,
    usage,
    // biome-ignore lint/suspicious/useAwait: CommandDef execute contract requires async signature
    async execute() {
      return { ok: true, content: 'noop' }
    },
  }
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
      commands: [cmd('reply', 'Send a reply.'), cmd('memory set', 'Upsert memory.'), cmd('hold', 'Put on hold.')],
    })
    // Constrain the search to the `## Commands` section so write-pattern
    // mentions of `vobase memory set` in the header don't skew positions.
    const commandsSection = md.slice(md.indexOf('## Commands'))
    const reply = commandsSection.indexOf('vobase reply')
    const memory = commandsSection.indexOf('vobase memory set')
    const hold = commandsSection.indexOf('vobase hold')
    expect(hold).toBeGreaterThan(-1)
    expect(memory).toBeGreaterThan(-1)
    expect(reply).toBeGreaterThan(-1)
    // alphabetical: hold < memory set < reply
    expect(hold).toBeLessThan(memory)
    expect(memory).toBeLessThan(reply)
  })

  it('emits framework preamble + layout reference + empty state', () => {
    const md = generateAgentsMd({ ...BASE, commands: [] })
    expect(md).toContain('## Layout')
    expect(md).toContain('## Commands')
    expect(md).toContain('_No commands registered._')
    expect(md).toContain('AGENTS.md')
  })

  it('emits write-patterns section enumerating per-scope mutation paths', () => {
    const md = generateAgentsMd({ ...BASE, commands: [] })
    expect(md).toContain('## Write patterns')
    expect(md).toContain('vobase memory set')
    expect(md).toContain('--scope=contact')
    expect(md).toContain('--scope=staff')
    expect(md).toContain('vobase drive propose')
    expect(md).toContain('`reply` tool')
    expect(md).toContain('/tmp/')
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
})
