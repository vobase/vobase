/**
 * Bash dispatcher → registry round-trip.
 *
 * The wake's bash sandbox uses `createBashVobaseCommand(registry, ctx)` to
 * route argv → registry → verb body → ExecResult. These tests exercise that
 * round-trip without spinning up a full workspace: fixture verbs registered
 * against a `CliVerbRegistry`, a `Bash` sandbox with the bash command
 * mounted, then `vobase ...` invocations checked for stdout / stderr /
 * exitCode parity with what the wake actually runs.
 *
 * Note: `Bash` here is `just-bash`'s in-memory sandbox interpreter — not a
 * `child_process` call.
 */

import { describe, expect, it } from 'bun:test'
import { Bash, InMemoryFs } from 'just-bash'
import { z } from 'zod'

import { createBashVobaseCommand } from './bash-vobase-command'
import { defineCliVerb } from './define'
import { CliVerbRegistry } from './registry'
import type { VerbContext } from './transport'

const CTX: VerbContext = {
  organizationId: 'org_test',
  principal: { kind: 'agent', id: 'agt_test' },
  wake: {
    conversationId: 'conv_test',
    contactId: 'ct_test',
    wakeId: 'wake_test',
    turnIndex: 0,
  },
}

function buildSandbox(
  registry: CliVerbRegistry,
  opts: { onSideEffect?: (verb: string) => void; audienceTier?: 'staff' | 'contact' } = {},
): Bash {
  return new Bash({
    fs: new InMemoryFs(),
    customCommands: [
      createBashVobaseCommand({
        registry,
        context: CTX,
        audienceTier: opts.audienceTier ?? 'staff',
        onSideEffect: opts.onSideEffect,
      }),
    ],
  })
}

async function run(sandbox: Bash, line: string) {
  return sandbox.exec(line)
}

describe('createBashVobaseCommand', () => {
  it('renders verb summary as stdout when present', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture echo',
        description: 'echoes the message back',
        input: z.object({ msg: z.string() }),
        body: async ({ input }) => ({
          ok: true as const,
          data: { msg: input.msg },
          summary: `Echoed: ${input.msg}`,
        }),
      }),
    )
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase fixture echo --msg=hello')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Echoed: hello\n')
    expect(result.stderr).toBe('')
  })

  it('falls back to compact JSON of `data` when no summary', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture struct',
        description: 'returns structured data',
        input: z.object({}),
        body: async () => ({ ok: true as const, data: { rows: 3 } }),
      }),
    )
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase fixture struct')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('{"rows":3}')
  })

  it('routes verb errors to stderr with non-zero exitCode', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture fail',
        description: 'returns an error',
        input: z.object({}),
        body: async () => ({ ok: false as const, error: 'boom', errorCode: 'fail' }),
      }),
    )
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase fixture fail')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('boom')
  })

  it('coerces --limit=10 to a number for `z.number()` schemas', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture limit',
        description: 'limit echo',
        input: z.object({ limit: z.number() }),
        body: async ({ input }) => ({
          ok: true as const,
          data: { limit: input.limit, type: typeof input.limit },
        }),
      }),
    )
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase fixture limit --limit=10')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('{"limit":10,"type":"number"}')
  })

  it('fires onSideEffect once per non-read-only verb', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture read',
        description: 'pure read',
        input: z.object({}),
        readOnly: true,
        body: async () => ({ ok: true as const, data: { ok: 1 } }),
      }),
    )
    r.register(
      defineCliVerb({
        name: 'fixture write',
        description: 'has side effects',
        input: z.object({}),
        body: async () => ({ ok: true as const, data: { ok: 1 }, summary: 'done' }),
      }),
    )
    const fired: string[] = []
    const sandbox = buildSandbox(r, { onSideEffect: (v) => fired.push(v) })
    await run(sandbox, 'vobase fixture read')
    await run(sandbox, 'vobase fixture write')
    expect(fired).toEqual(['fixture write'])
  })

  it('renders --help with the verb catalog filtered by wake tier', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture contact-tier',
        description: 'visible to contact wakes',
        input: z.object({}),
        audience: 'contact',
        body: async () => ({ ok: true as const, data: {} }),
      }),
    )
    r.register(
      defineCliVerb({
        name: 'fixture staff-tier',
        description: 'visible to staff wakes',
        input: z.object({}),
        audience: 'staff',
        body: async () => ({ ok: true as const, data: {} }),
      }),
    )
    r.register(
      defineCliVerb({
        name: 'fixture admin-only',
        description: 'admin only — hidden from wakes',
        input: z.object({}),
        audience: 'admin',
        body: async () => ({ ok: true as const, data: {} }),
      }),
    )
    // staff-tier sandbox: sees contact + staff verbs, not admin
    const staffSandbox = buildSandbox(r, { audienceTier: 'staff' })
    const staffHelp = await run(staffSandbox, 'vobase --help')
    expect(staffHelp.exitCode).toBe(0)
    expect(staffHelp.stdout).toContain('fixture contact-tier')
    expect(staffHelp.stdout).toContain('fixture staff-tier')
    expect(staffHelp.stdout).not.toContain('fixture admin-only')

    // contact-tier sandbox: sees only contact verbs
    const contactSandbox = buildSandbox(r, { audienceTier: 'contact' })
    const contactHelp = await run(contactSandbox, 'vobase --help')
    expect(contactHelp.exitCode).toBe(0)
    expect(contactHelp.stdout).toContain('fixture contact-tier')
    expect(contactHelp.stdout).not.toContain('fixture staff-tier')
    expect(contactHelp.stdout).not.toContain('fixture admin-only')
  })

  it('returns "unknown subcommand" with exitCode 1 for unmatched argv', async () => {
    const r = new CliVerbRegistry()
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase nope')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('unknown subcommand')
  })

  it('admin-tier verbs are callable via in-process dispatch even though --help hides them', async () => {
    // Audience filtering is a visibility concern (--help, AGENTS.md), not a
    // dispatch gate. Admin-tagged verbs run fine when the agent knows the name.
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture admin',
        description: 'admin only',
        input: z.object({}),
        audience: 'admin',
        body: async () => ({ ok: true as const, data: { ok: 1 } }),
      }),
    )
    // admin verb is hidden from --help on a staff-tier sandbox
    const sandbox = buildSandbox(r, { audienceTier: 'staff' })
    const helpResult = await run(sandbox, 'vobase --help')
    expect(helpResult.stdout).not.toContain('fixture admin')
    // but dispatches successfully when invoked directly
    const dispatchResult = await run(sandbox, 'vobase fixture admin')
    expect(dispatchResult.exitCode).toBe(0)
  })
})
