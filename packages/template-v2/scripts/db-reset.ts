#!/usr/bin/env bun
/**
 * db:reset — single entry point that nukes the DB, applies fixtures+schema,
 * applies extras, then seeds. Replaces the npm-script chain with one Bun script
 * so failures are easier to read and so the steps can be reused programmatically.
 */

const dir = import.meta.dir
const cwd = `${dir}/..`

function run(label: string, script: string): void {
  process.stdout.write(`\n→ ${label}\n`)
  const result = Bun.spawnSync(['bun', 'run', `${dir}/${script}`], {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd,
  })
  if (result.exitCode !== 0) {
    process.stderr.write(`✗ ${label} failed\n`)
    process.exit(result.exitCode ?? 1)
  }
}

run('db:nuke', 'db-nuke.ts')
run('db:push', 'db-push.ts')
run('db:seed', 'seed.ts')

process.stdout.write('\n✓ db:reset complete\n')
