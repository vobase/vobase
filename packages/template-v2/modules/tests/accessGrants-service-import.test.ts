// Negative test: any file under modules/<source>/service/ that imports from
// @modules/<target>/service/ must have a matching accessGrants entry in the
// source module's manifest.ts declaring `to: '<target>'`.
// Step 6a inventory produced .omc/plans/ralplan-module-primitives-cross-import-inventory.md
// with the Day-1 grants (drive → agents:learning-proposals only). Phase 0 non-strict;
// Step 8 strict flip promotes to failing.
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = join(import.meta.dir, '..')
const STRICT = process.env.CHECK_SHAPE_STRICT === 'true'
const CROSS_SERVICE_RE = /from\s+['"]@modules\/([^/'"]+)\/service\//g

function* walk(dir: string): Generator<string> {
  try {
    if (!statSync(dir).isDirectory()) return
  } catch {
    return
  }
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue
      yield* walk(full)
    } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) {
      yield full
    }
  }
}

function listModules(): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = []
  for (const ent of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === 'tests') continue
    if (ent.name === 'channels') {
      for (const child of readdirSync(join(MODULES_DIR, 'channels'), { withFileTypes: true })) {
        if (child.isDirectory()) {
          out.push({ name: `channels/${child.name}`, dir: join(MODULES_DIR, 'channels', child.name) })
        }
      }
    } else {
      out.push({ name: ent.name, dir: join(MODULES_DIR, ent.name) })
    }
  }
  return out
}

describe('module shape: accessGrants cover cross-module service imports', () => {
  it(`${STRICT ? 'strict' : 'non-strict'}: every @modules/<other>/service/ import is declared in manifest.accessGrants`, async () => {
    const violations: Array<{ source: string; target: string; file: string }> = []
    for (const mod of listModules()) {
      const manifestPath = join(mod.dir, 'manifest.ts')
      const manifestSrc = existsSync(manifestPath) ? await Bun.file(manifestPath).text() : ''
      const serviceDir = join(mod.dir, 'service')
      for (const file of walk(serviceDir)) {
        const src = await Bun.file(file).text()
        for (const m of src.matchAll(CROSS_SERVICE_RE)) {
          const target = m[1]
          if (target === mod.name) continue
          const ownsGrant = manifestSrc.includes(`to: '${target}'`) || manifestSrc.includes(`to: "${target}"`)
          if (!ownsGrant) {
            violations.push({ source: mod.name, target, file })
          }
        }
      }
    }
    if (STRICT) {
      expect(violations).toEqual([])
    } else {
      if (violations.length > 0) {
        console.warn(`[accessGrants-service-import] ${violations.length} migration-window violations (non-strict)`)
      }
      expect(Array.isArray(violations)).toBe(true)
    }
  })
})
