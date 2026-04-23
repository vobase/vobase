import { describe, expect, it } from 'bun:test'
import type { CommandDef } from '../harness/types'
import { generateAgentsMd } from './agents-md-generator'

function cmd(name: string, description: string, usage?: string): CommandDef {
  return {
    name,
    description,
    usage,
    async execute() {
      return { ok: true, content: 'noop' }
    },
  }
}

describe('generateAgentsMd', () => {
  it('renders commands in alphabetical order', () => {
    const md = generateAgentsMd({
      commands: [cmd('reply', 'Send a reply.'), cmd('memory set', 'Upsert memory.'), cmd('hold', 'Put on hold.')],
    })
    const reply = md.indexOf('vobase reply')
    const memory = md.indexOf('vobase memory set')
    const hold = md.indexOf('vobase hold')
    expect(hold).toBeGreaterThan(-1)
    expect(memory).toBeGreaterThan(-1)
    expect(reply).toBeGreaterThan(-1)
    // alphabetical: hold < memory set < reply
    expect(hold).toBeLessThan(memory)
    expect(memory).toBeLessThan(reply)
  })

  it('includes layout reference + empty state', () => {
    const md = generateAgentsMd({ commands: [] })
    expect(md).toContain('# Vobase Workspace')
    expect(md).toContain('_No commands registered._')
    expect(md).toContain('AGENTS.md')
    expect(md).toContain('## Layout')
  })
})
