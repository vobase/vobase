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

function buildSandbox(registry: CliVerbRegistry, opts: { onSideEffect?: (verb: string) => void } = {}): Bash {
  return new Bash({
    fs: new InMemoryFs(),
    customCommands: [createBashVobaseCommand({ registry, context: CTX, onSideEffect: opts.onSideEffect })],
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

  it('renders --help with the verb catalog (skipping staff-only)', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture all',
        description: 'visible',
        input: z.object({}),
        body: async () => ({ ok: true as const, data: {} }),
      }),
    )
    r.register(
      defineCliVerb({
        name: 'fixture hidden',
        description: 'staff only',
        input: z.object({}),
        audience: 'staff',
        body: async () => ({ ok: true as const, data: {} }),
      }),
    )
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase --help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('fixture all')
    expect(result.stdout).not.toContain('fixture hidden')
  })

  it('returns "unknown subcommand" with exitCode 1 for unmatched argv', async () => {
    const r = new CliVerbRegistry()
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase nope')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('unknown subcommand')
  })

  it('blocks staff-only verbs from in-process dispatch with forbidden errorCode', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'fixture staff',
        description: 'staff only',
        input: z.object({}),
        audience: 'staff',
        body: async () => ({ ok: true as const, data: { ok: 1 } }),
      }),
    )
    const sandbox = buildSandbox(r)
    const result = await run(sandbox, 'vobase fixture staff')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('staff-only')
  })
})
