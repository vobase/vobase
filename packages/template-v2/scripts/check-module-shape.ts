#!/usr/bin/env bun
/**
 * CI lint — journal write-path guard.
 *
 * After slice 2c.3 simplified the module shape (named-export modules, no
 * manifest.ts, no define-module.ts), most of the old per-module shape checks
 * are either unenforceable or moot. The one invariant that still matters is
 * the one-write-path guard for the `messages` / `conversation_events` tables:
 * only `modules/inbox/service/**` and `modules/agents/service/journal.ts` /
 * `learning-proposals.ts` may mutate those tables.
 */

import { join } from 'node:path'

const MODULES_DIR = join(import.meta.dir, '..', 'modules')

const JOURNAL_WRITE_RE = /\.(insert|update|delete)\s*\(\s*(messages|conversationEvents)\b/
const JOURNAL_WRITE_ALLOWED = [
  'modules/inbox/service/',
  'modules/agents/service/journal.ts',
  'modules/agents/service/learning-proposals.ts',
]

const errors: Array<{ file: string; line: number; message: string }> = []

async function checkJournalWriteAuthority(): Promise<void> {
  const glob = new Bun.Glob('**/*.ts')
  for await (const entry of glob.scan({ cwd: MODULES_DIR })) {
    if (entry.endsWith('.test.ts') || entry.includes('__tests__/')) continue
    const fullPath = join(MODULES_DIR, entry)
    const relFromModules = `modules/${entry}`
    if (JOURNAL_WRITE_ALLOWED.some((prefix) => relFromModules.startsWith(prefix))) continue
    const lines = (await Bun.file(fullPath).text()).split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
      const m = JOURNAL_WRITE_RE.exec(line)
      if (m) {
        errors.push({
          file: fullPath,
          line: i + 1,
          message: `writes to "${m[2]}" only allowed in inbox/service or agents/service/journal.ts (one-write-path)`,
        })
      }
    }
  }
}

await checkJournalWriteAuthority()

if (errors.length > 0) {
  console.error('\ncheck-module-shape: FAILED\n')
  for (const err of errors) console.error(`  ${err.file}:${err.line}: ${err.message}`)
  console.error(`\n${errors.length} error(s) found.`)
  process.exit(1)
}

console.log('check-module-shape: journal-write-path guard OK')
process.exit(0)
