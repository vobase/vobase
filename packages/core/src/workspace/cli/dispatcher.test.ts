import { describe, expect, it, mock } from 'bun:test'
import type { CommandContext as JustBashCtx } from 'just-bash'

import type { CommandContext, CommandDef } from '../../harness/types'
import { createVobaseCommand, findCommand, resolveCommandSet, VobaseCliCollisionError } from './dispatcher'

const ctx: CommandContext = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  agentId: 'a-1',
  contactId: 'c-1',
  writeWorkspace: async () => {},
  readWorkspace: async () => '',
}

// Sparse `just-bash` CommandContext — every field is ignored by the
// dispatcher closure, so a cast keeps the unit test focused on routing.
const jbCtx = Object.freeze({
  fs: {} as unknown,
  cwd: '/',
  env: new Map<string, string>(),
  stdin: '',
}) as unknown as JustBashCtx

function defCmd(name: string, content = 'ok'): CommandDef {
  return {
    name,
    description: `desc(${name})`,
    execute: async () => ({ ok: true, content }),
  }
}

describe('resolveCommandSet', () => {
  it('throws when the same verb appears in multiple sets', () => {
    expect(() =>
      resolveCommandSet({
        ctx,
        commands: [defCmd('shared')],
        roleVerbSets: { operator: [defCmd('shared')] },
      }),
    ).toThrow(VobaseCliCollisionError)
  })

  it('returns global commands plus the active role set only', () => {
    const list = resolveCommandSet({
      ctx,
      commands: [defCmd('help')],
      roleVerbSets: {
        concierge: [defCmd('reply')],
        operator: [defCmd('run-job')],
      },
      currentRole: 'operator',
    })
    expect(list.map((c) => c.name).sort()).toEqual(['help', 'run-job'])
  })

  it('returns global commands only when currentRole is undefined', () => {
    const list = resolveCommandSet({
      ctx,
      commands: [defCmd('help')],
      roleVerbSets: { operator: [defCmd('run-job')] },
    })
    expect(list.map((c) => c.name)).toEqual(['help'])
  })
})

describe('findCommand', () => {
  it('matches longest-prefix names first', () => {
    const memorySet = defCmd('memory set')
    const memory = defCmd('memory')
    const result = findCommand(['memory', 'set', 'k', 'v'], [memory, memorySet])
    expect(result.cmd?.name).toBe('memory set')
    expect(result.nameTokens).toBe(2)
  })

  it('returns null when nothing matches', () => {
    const result = findCommand(['unknown'], [defCmd('memory set')])
    expect(result.cmd).toBeNull()
  })
})

describe('createVobaseCommand', () => {
  it('routes argv to the matched command and trips onSideEffect for non-read-only verbs', async () => {
    const onSideEffect = mock((_cmd: CommandDef) => {})
    const cmd = createVobaseCommand({
      ctx,
      commands: [defCmd('write-something', 'wrote!')],
      onSideEffect,
    })
    // Drive the just-bash Command via its handler closure.
    // `defineCommand` returns an object we can treat as `{ name, handler }`.
    const result = await cmd.execute(['write-something'], jbCtx)
    expect(result.stdout).toBe('wrote!\n')
    expect(result.exitCode).toBe(0)
    expect(onSideEffect.mock.calls.length).toBe(1)
  })

  it('skips onSideEffect for known read-only verbs', async () => {
    const onSideEffect = mock((_cmd: CommandDef) => {})
    const cmd = createVobaseCommand({
      ctx,
      commands: [{ ...defCmd('memory view'), execute: async () => ({ ok: true, content: 'memory view: ok' }) }],
      onSideEffect,
    })
    const result = await cmd.execute(['memory', 'view'], jbCtx)
    expect(result.exitCode).toBe(0)
    expect(onSideEffect.mock.calls.length).toBe(0)
  })

  it('throws at construction time when role sets collide', () => {
    expect(() =>
      createVobaseCommand({
        ctx,
        roleVerbSets: { concierge: [defCmd('reply')], operator: [defCmd('reply')] },
        currentRole: 'concierge',
      }),
    ).toThrow(VobaseCliCollisionError)
  })

  it('shows registered commands in the help listing for the active role', async () => {
    const cmd = createVobaseCommand({
      ctx,
      commands: [defCmd('help')],
      roleVerbSets: {
        concierge: [defCmd('reply')],
        operator: [defCmd('run-job')],
      },
      currentRole: 'operator',
    })
    const result = await cmd.execute(['help'], jbCtx)
    expect(result.stdout).toContain('vobase help')
    expect(result.stdout).toContain('vobase run-job')
    // Concierge-only verbs must NOT leak into operator's help.
    expect(result.stdout).not.toContain('vobase reply')
  })
})
