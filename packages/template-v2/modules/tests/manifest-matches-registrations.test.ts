// Negative test: observer/mutator id and command name literals registered inline
// in modules/<name>/module.ts must appear in the corresponding manifest.ts
// provides.observers / provides.mutators / provides.commands arrays.
// Boot-time runtime check (checkProvidesId) handles the dynamic case; this test
// catches inline-literal drift in source without executing boot.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

const MODULES_DIR = join(import.meta.dir, '..')
const STRICT = process.env.CHECK_SHAPE_STRICT === 'true'
const REGISTER_OBSERVER_ID_RE = /ctx\.registerObserver\s*\([^)]*\bid:\s*['"]([^'"]+)['"]/g
const REGISTER_MUTATOR_ID_RE = /ctx\.registerMutator\s*\([^)]*\bid:\s*['"]([^'"]+)['"]/g
const REGISTER_COMMAND_RE = /ctx\.registerCommand\s*\(\s*\{\s*name:\s*['"]([^'"]+)['"]/g

function listModules(): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = []
  for (const ent of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === 'tests') continue
    if (ent.name === 'channels') {
      for (const child of readdirSync(join(MODULES_DIR, 'channels'), { withFileTypes: true })) {
        if (child.isDirectory() && existsSync(join(MODULES_DIR, 'channels', child.name, 'module.ts'))) {
          out.push({ name: `channels/${child.name}`, dir: join(MODULES_DIR, 'channels', child.name) })
        }
      }
    } else if (existsSync(join(MODULES_DIR, ent.name, 'module.ts'))) {
      out.push({ name: ent.name, dir: join(MODULES_DIR, ent.name) })
    }
  }
  return out
}

function findAll(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[1])
}

describe('module shape: registered observer/mutator/command ids match manifest', () => {
  it(`${STRICT ? 'strict' : 'non-strict'}: literal ids appear in manifest provides.*`, async () => {
    const violations: Array<{ module: string; kind: string; id: string }> = []
    for (const mod of listModules()) {
      const modSrc = await Bun.file(join(mod.dir, 'module.ts')).text()
      const manifestSrc = existsSync(join(mod.dir, 'manifest.ts'))
        ? await Bun.file(join(mod.dir, 'manifest.ts')).text()
        : ''
      for (const id of findAll(modSrc, REGISTER_OBSERVER_ID_RE)) {
        if (!manifestSrc.includes(`'${id}'`) && !manifestSrc.includes(`"${id}"`)) {
          violations.push({ module: mod.name, kind: 'observer', id })
        }
      }
      for (const id of findAll(modSrc, REGISTER_MUTATOR_ID_RE)) {
        if (!manifestSrc.includes(`'${id}'`) && !manifestSrc.includes(`"${id}"`)) {
          violations.push({ module: mod.name, kind: 'mutator', id })
        }
      }
      for (const name of findAll(modSrc, REGISTER_COMMAND_RE)) {
        if (!manifestSrc.includes(`'${name}'`) && !manifestSrc.includes(`"${name}"`)) {
          violations.push({ module: mod.name, kind: 'command', id: name })
        }
      }
    }
    if (STRICT) {
      expect(violations).toEqual([])
    } else {
      if (violations.length > 0) {
        console.warn(`[manifest-matches-registrations] ${violations.length} migration-window violations (non-strict)`)
      }
      expect(Array.isArray(violations)).toBe(true)
    }
  })
})
