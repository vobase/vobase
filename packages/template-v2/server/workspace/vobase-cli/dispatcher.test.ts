import { describe, expect, it } from 'bun:test'
import type { CommandContext, CommandDef } from '@server/common/port-types'
import { Bash } from 'just-bash'

import { createVobaseCommand } from './dispatcher'

function cmd(name: string, fn?: CommandDef['execute']): CommandDef {
  return {
    name,
    description: `${name} cmd`,
    async execute(argv, ctx) {
      if (fn) return fn(argv, ctx)
      return { ok: true, content: `${name} ${argv.join(',')}` }
    },
  }
}

const CTX: CommandContext = {
  organizationId: 't1',
  conversationId: 'c1',
  agentId: 'a1',
  contactId: 'k1',
  async writeWorkspace() {},
  async readWorkspace() {
    return ''
  },
}

async function runBash(commands: readonly CommandDef[], line: string) {
  const bash = new Bash({ customCommands: [createVobaseCommand({ commands, ctx: CTX })] })
  return bash.exec(line)
}

describe('vobase dispatcher', () => {
  it('routes single-word subcommand', async () => {
    const r = await runBash([cmd('reply')], 'vobase reply hi there')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('reply hi,there')
  })

  it('prefers longest-prefix for multi-word subcommand names', async () => {
    const r = await runBash([cmd('memory'), cmd('memory set')], 'vobase memory set heading body')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('memory set heading,body')
  })

  it('returns non-zero on unknown subcommand', async () => {
    const r = await runBash([cmd('reply')], 'vobase unknown-verb')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('unknown subcommand')
  })

  it('renders help with no commands', async () => {
    const r = await runBash([], 'vobase')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('no commands registered')
  })

  it('triggers onSideEffect for writes but not read-only verbs', async () => {
    let sideEffects = 0
    const commands = [cmd('resolve'), cmd('memory view')]
    const vobaseCmd = createVobaseCommand({
      commands,
      ctx: CTX,
      onSideEffect: () => {
        sideEffects += 1
      },
    })
    const bash = new Bash({ customCommands: [vobaseCmd] })
    await bash.exec('vobase memory view')
    await bash.exec('vobase resolve')
    expect(sideEffects).toBe(1)
  })
})
