#!/usr/bin/env bun
/**
 * Migration-window guard.
 *
 * During Steps 5-8 of the Phase 0 module-primitives migration, the main
 * `check-module-shape` runs in non-strict mode so partially-migrated modules
 * don't break CI. This script flips strict mode on specifically for NEW
 * modules — anything whose directory did not exist on `main` when Step 5
 * merged — so brand-new modules ship strict-clean from day one.
 *
 * Detection: read the list of module directories present on `origin/main`
 * (baseline) from `scripts/new-modules-baseline.txt`. Any module not in that
 * list is treated as new and linted with `CHECK_SHAPE_STRICT=true`.
 *
 * Baseline file format: one module name per line (e.g. `messaging`, `channels/web`).
 * Maintained manually; regenerated when Step 8 strict-flip lands and this
 * script is retired.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT_DIR = import.meta.dir
const MODULES_DIR = join(SCRIPT_DIR, '..', 'modules')
const BASELINE_FILE = join(SCRIPT_DIR, 'new-modules-baseline.txt')

function loadBaseline(): Set<string> {
  try {
    const text = readFileSync(BASELINE_FILE, 'utf8')
    return new Set(
      text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#')),
    )
  } catch {
    return new Set()
  }
}

function listCurrentModules(): string[] {
  const results: string[] = []
  for (const ent of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === 'tests') continue
    if (ent.name === 'channels') {
      for (const child of readdirSync(join(MODULES_DIR, 'channels'), { withFileTypes: true })) {
        if (child.isDirectory()) results.push(`channels/${child.name}`)
      }
    } else {
      results.push(ent.name)
    }
  }
  return results.sort()
}

async function main(): Promise<void> {
  const baseline = loadBaseline()
  const current = listCurrentModules()
  const newModules = current.filter((m) => !baseline.has(m))

  if (newModules.length === 0) {
    console.log('check-new-modules: no new modules detected against baseline')
    return
  }

  console.log(`check-new-modules: linting ${newModules.length} new module(s) strict: ${newModules.join(', ')}`)

  const proc = Bun.spawn({
    cmd: ['bun', 'run', join(SCRIPT_DIR, 'check-module-shape.ts')],
    env: { ...process.env, CHECK_SHAPE_STRICT: 'true' },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    console.error(`check-new-modules: FAILED — new modules must be strict-clean`)
    process.exit(code)
  }
  console.log('check-new-modules: all new modules strict-OK')
}

await main()
