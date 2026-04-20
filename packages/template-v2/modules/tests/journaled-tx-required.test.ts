// Negative test: files under modules/<name>/service/ must not import drizzle-orm
// directly or invoke db.transaction(...) — mutations flow through
// ctx.withJournaledTx(fn) which enforces a mandatory journal append.
// Whitelist: modules/agents/service/journal.ts is the sole raw-tx writer
// (one-write-path for conversation_events). Phase 0: non-strict.
import { describe, expect, it } from 'bun:test'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = join(import.meta.dir, '..')
const STRICT = process.env.CHECK_SHAPE_STRICT === 'true'
const DRIZZLE_IMPORT_RE = /from\s+['"]drizzle-orm/
const DB_TRANSACTION_RE = /\bdb\.transaction\s*\(/
const WHITELIST = new Set(['agents/service/journal.ts'])

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

function serviceFiles(): Array<{ path: string; rel: string }> {
  const out: Array<{ path: string; rel: string }> = []
  for (const ent of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === 'tests') continue
    if (ent.name === 'channels') {
      for (const child of readdirSync(join(MODULES_DIR, 'channels'), { withFileTypes: true })) {
        if (!child.isDirectory()) continue
        const svc = join(MODULES_DIR, 'channels', child.name, 'service')
        for (const path of walk(svc)) {
          out.push({ path, rel: `channels/${child.name}/service/${path.slice(svc.length + 1)}` })
        }
      }
    } else {
      const svc = join(MODULES_DIR, ent.name, 'service')
      for (const path of walk(svc)) {
        out.push({ path, rel: `${ent.name}/service/${path.slice(svc.length + 1)}` })
      }
    }
  }
  return out
}

describe('module shape: no raw drizzle or db.transaction() in service files', () => {
  it(`${STRICT ? 'strict' : 'non-strict'}: ${STRICT ? 'fails on' : 'tolerates'} raw drizzle imports / db.transaction() outside withJournaledTx`, async () => {
    const violations: Array<{ file: string; line: number; kind: 'drizzle-import' | 'db-transaction' }> = []
    for (const { path, rel } of serviceFiles()) {
      if (WHITELIST.has(rel)) continue
      const src = await Bun.file(path).text()
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (DRIZZLE_IMPORT_RE.test(lines[i])) {
          violations.push({ file: path, line: i + 1, kind: 'drizzle-import' })
        }
        if (DB_TRANSACTION_RE.test(lines[i])) {
          violations.push({ file: path, line: i + 1, kind: 'db-transaction' })
        }
      }
    }
    if (STRICT) {
      expect(violations).toEqual([])
    } else {
      if (violations.length > 0) {
        console.warn(`[journaled-tx-required] ${violations.length} migration-window violations (non-strict)`)
      }
      expect(Array.isArray(violations)).toBe(true)
    }
  })
})
