// Negative test: files under modules/<name>/service/ must not declare
// top-level mutable singletons like `let _db`, `let _tenantId`, `let _scheduler`.
// Services are constructed via factory functions (createXService({ db, organizationId })).
// Phase 0: non-strict — reports violations but does not fail the suite until each
// module migrates. Step 8 (strict flip) promotes this to failing.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

const MODULES_DIR = join(import.meta.dir, '..')
const STRICT = process.env.CHECK_SHAPE_STRICT === 'true'
const SINGLETON_RE = /^\s*let\s+(_db|_tenantId|_organizationId|_scheduler|_port)\b/

function listModuleServiceFiles(): string[] {
  const out: string[] = []
  const topLevel = readdirSync(MODULES_DIR, { withFileTypes: true })
  for (const ent of topLevel) {
    if (!ent.isDirectory()) continue
    if (ent.name === 'tests') continue
    if (ent.name === 'channels') {
      for (const child of readdirSync(join(MODULES_DIR, 'channels'), { withFileTypes: true })) {
        if (child.isDirectory()) scanServiceDir(join(MODULES_DIR, 'channels', child.name, 'service'), out)
      }
    } else {
      scanServiceDir(join(MODULES_DIR, ent.name, 'service'), out)
    }
  }
  return out
}

function scanServiceDir(dir: string, out: string[]): void {
  try {
    if (!statSync(dir).isDirectory()) return
  } catch {
    return
  }
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue
      scanServiceDir(full, out)
    } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
}

describe('module shape: no file-level singletons', () => {
  it(`${STRICT ? 'strict' : 'non-strict'}: ${STRICT ? 'fails on' : 'tolerates'} singleton declarations across modules/*/service/`, async () => {
    const violations: Array<{ file: string; line: number; name: string }> = []
    for (const file of listModuleServiceFiles()) {
      const src = await Bun.file(file).text()
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(SINGLETON_RE)
        if (m) violations.push({ file, line: i + 1, name: m[1] })
      }
    }
    if (STRICT) {
      expect(violations).toEqual([])
    } else {
      if (violations.length > 0) {
        console.warn(`[no-file-level-singletons] ${violations.length} migration-window violations (non-strict)`)
      }
      expect(Array.isArray(violations)).toBe(true)
    }
  })
})
