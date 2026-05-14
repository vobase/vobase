#!/usr/bin/env bun
/**
 * check:auth-schema — fail CI when `auth/schema.ts` / `auth/schema-tables.ts`
 * have drifted from what `bun run gen:auth` would produce.
 *
 * The generated auth schema is committed (so drizzle-kit and the editor see
 * it without a generate step), which means it can silently fall behind the
 * better-auth plugin set. This check regenerates into a scratch dir, formats
 * it the same way `gen:auth` does, and diffs against the committed files.
 */

import { rm } from 'node:fs/promises'

import { generateAuthSchema } from './gen-auth-schema'

const TEMPLATE_ROOT = `${import.meta.dir}/..`
const SCRATCH = `${TEMPLATE_ROOT}/.auth-gen/check`

async function detectDrift(): Promise<string[]> {
  const { tables, schema } = await generateAuthSchema()
  await Bun.write(`${SCRATCH}/schema-tables.ts`, tables)
  await Bun.write(`${SCRATCH}/schema.ts`, schema)

  const fmt = Bun.spawnSync(
    [
      'bunx',
      'biome',
      'check',
      '--write',
      // `.auth-gen/` is gitignored; without this biome's `useIgnoreFile` skips it.
      '--vcs-enabled=false',
      '.auth-gen/check/schema-tables.ts',
      '.auth-gen/check/schema.ts',
    ],
    { cwd: TEMPLATE_ROOT, stdio: ['inherit', 'inherit', 'inherit'] },
  )
  if (fmt.exitCode !== 0) {
    throw new Error('check:auth-schema — biome formatting of regenerated schema failed')
  }

  const pairs = [
    ['schema-tables.ts', `${SCRATCH}/schema-tables.ts`, `${TEMPLATE_ROOT}/auth/schema-tables.ts`],
    ['schema.ts', `${SCRATCH}/schema.ts`, `${TEMPLATE_ROOT}/auth/schema.ts`],
  ] as const

  const drifted: string[] = []
  for (const [name, freshPath, committedPath] of pairs) {
    const fresh = await Bun.file(freshPath).text()
    const committed = await Bun.file(committedPath)
      .text()
      .catch(() => '')
    if (fresh !== committed) drifted.push(name)
  }
  return drifted
}

let drifted: string[]
try {
  drifted = await detectDrift()
} finally {
  await rm(`${TEMPLATE_ROOT}/.auth-gen`, { recursive: true, force: true })
}

if (drifted.length > 0) {
  process.stderr.write(
    `✗ check:auth-schema — auth/${drifted.join(', auth/')} is stale.\n` +
      '  The auth schema is generated from auth/auth.config.ts. Run `bun run gen:auth` and commit the result.\n',
  )
  process.exit(1)
}

process.stdout.write('✓ check:auth-schema — generated auth schema is up to date\n')
