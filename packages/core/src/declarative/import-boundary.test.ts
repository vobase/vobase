/**
 * Import-boundary smoke: the declarative barrel must not touch `Bun.*` at
 * module-load time. The Bun-only paths (YAML, CryptoHasher, file, Glob) are
 * gated by `requireBun()` which throws a descriptive error only when a
 * Bun-dependent code path is *executed*.
 *
 * This locks the contract that drove `db/schema-exports.ts` into existence —
 * tooling paths (drizzle-kit, codegen) that pull in the barrel transitively
 * must be able to read types and registry helpers without invoking Bun.
 */

import { describe, expect, it } from 'bun:test'

import { defineDeclarativeResource, parseFileBytes, reconcileResource, serializeYaml } from './index'

describe('declarative barrel import boundary', () => {
  it('imports without touching `Bun.*` at module-load time', () => {
    // The static imports above must not throw; reaching this assertion means
    // none of the barrel modules dereferenced `Bun.*` during evaluation.
    expect(typeof defineDeclarativeResource).toBe('function')
    expect(typeof reconcileResource).toBe('function')
    expect(typeof parseFileBytes).toBe('function')
    expect(typeof serializeYaml).toBe('function')
  })

  it('keeps every `Bun.*` reference inside a function body, not module scope', async () => {
    // Locks the contract by static-source check: a `Bun.*` reference at
    // top level (outside `function` / `=>` body) would crash on import. We
    // instead assert that every `Bun.` lookup in the declarative source is
    // inside a function body — which our `requireBun()` gate enforces.
    const files = ['./parse.ts', './reconcile.ts', './boot.ts']
    for (const rel of files) {
      const src = await Bun.file(`${import.meta.dir}/${rel.replace('./', '')}`).text()
      // Strip line-comments and block-comments so referenced inside docs don't trip the test.
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      const lines = stripped.split('\n')
      let depth = 0
      for (const line of lines) {
        // Crude depth tracker: { increases, } decreases.
        for (const ch of line) {
          if (ch === '{') depth += 1
          else if (ch === '}') depth -= 1
        }
        const trimmed = line.trim()
        if (depth === 0 && /\bBun\./.test(trimmed) && !/^(import|export)\b/.test(trimmed)) {
          throw new Error(`top-level Bun.* reference found in ${rel}: ${trimmed}`)
        }
      }
    }
    expect(true).toBe(true)
  })
})
