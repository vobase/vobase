#!/usr/bin/env bun
/**
 * db:migrate — runs `drizzle-kit migrate` against DATABASE_URL.
 *
 * v2 currently uses push-based schema sync (`db:push`) for development.
 * This script exists so production deployments can adopt drizzle-kit
 * migrations once schema generation lands. If no `drizzle/` folder is
 * present, drizzle-kit exits with a clear error.
 */

const cwd = `${import.meta.dir}/..`

const result = Bun.spawnSync(['bun', 'run', 'drizzle-kit', 'migrate'], {
  stdio: ['inherit', 'inherit', 'inherit'],
  cwd,
})

if (result.exitCode !== 0) {
  process.stderr.write('✗ drizzle-kit migrate failed\n')
  process.exit(result.exitCode ?? 1)
}

process.stdout.write('✓ db:migrate complete\n')
