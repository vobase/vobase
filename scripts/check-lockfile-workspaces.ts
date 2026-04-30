#!/usr/bin/env bun
/**
 * Workspace allowlist gate for bun.lock.
 *
 * macOS Bun (1.3.13) auto-discovers nested package.json files in directories
 * that aren't in the workspaces glob (e.g. `poc/`) and adds them to bun.lock.
 * Linux Bun in CI doesn't, so a frozen install rejects the lockfile with
 * "lockfile had changes, but lockfile is frozen".
 *
 * This script reads the workspace globs from root package.json, expands them
 * to the set of allowed workspace keys, then walks the `workspaces` section
 * of bun.lock and fails if any key is outside that set (the empty key `""`
 * for the root workspace is always allowed).
 *
 * Run via `bun run check:lockfile` or the .githooks/pre-commit hook.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const repoRoot = join(import.meta.dir, '..')
const pkgPath = join(repoRoot, 'package.json')
const lockPath = join(repoRoot, 'bun.lock')

interface RootPkg {
  workspaces?: string[]
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as RootPkg
const globs = pkg.workspaces ?? []

const allowed = new Set<string>([''])

for (const pattern of globs) {
  if (pattern.startsWith('!')) continue
  const glob = new Bun.Glob(pattern)
  for (const match of glob.scanSync({ cwd: repoRoot, onlyFiles: false })) {
    const abs = join(repoRoot, match)
    if (!existsSync(join(abs, 'package.json'))) continue
    allowed.add(relative(repoRoot, abs).replaceAll('\\', '/'))
  }
}

const lockText = readFileSync(lockPath, 'utf8')
const wsHeader = lockText.indexOf('"workspaces": {')
if (wsHeader === -1) {
  console.error(`✗ ${lockPath}: missing "workspaces" section`)
  process.exit(1)
}
const wsBody = lockText.slice(wsHeader)
const endIdx = wsBody.indexOf('\n  }')
const wsBlock = wsBody.slice(0, endIdx === -1 ? undefined : endIdx)

const keyRe = /^    "([^"]*)":\s*\{/gm
const seen = new Set<string>()
const violations: string[] = []
for (const m of wsBlock.matchAll(keyRe)) {
  const key = m[1]
  if (key === undefined) continue
  seen.add(key)
  if (!allowed.has(key)) violations.push(key)
}

if (violations.length > 0) {
  console.error('✗ bun.lock has workspaces outside the allowed glob:')
  for (const v of violations) console.error(`    "${v}"`)
  console.error(`\nAllowed: ${[...allowed].sort().map((k) => `"${k}"`).join(', ')}`)
  console.error('\nFix: regenerate bun.lock without those entries (the simplest path is')
  console.error('to run `bun install` inside a Linux Docker container, then commit).')
  process.exit(1)
}

console.log(`✓ bun.lock workspaces match package.json globs (${seen.size} entries)`)
