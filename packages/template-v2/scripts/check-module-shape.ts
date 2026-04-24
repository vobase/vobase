#!/usr/bin/env bun
/**
 * CI lint — journal write-path guard.
 *
 * After slice 3a moved harness persistence to `@vobase/core`, the journal
 * (`conversation_events`) is written exclusively by core's `harness/journal.ts`.
 * Template code only reaches `conversationEvents` via the core barrel, and the
 * one-write-path invariant for `messaging.messages` stays enforced here: only
 * `modules/messaging/service/**` may mutate the customer message table.
 * `modules/agents/service/learning-proposals.ts` still emits learning_approved /
 * learning_rejected rows directly into `conversation_events` for the approval
 * path, so it keeps an allowlist entry.
 */

import { join } from 'node:path'

const MODULES_DIR = join(import.meta.dir, '..', 'modules')

const JOURNAL_WRITE_RE = /\.(insert|update|delete)\s*\(\s*(messages|conversationEvents)\b/
const JOURNAL_WRITE_ALLOWED = ['modules/messaging/service/', 'modules/agents/service/learning-proposals.ts']

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
          message: `writes to "${m[2]}" only allowed in messaging/service or agents/service/journal.ts (one-write-path)`,
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

console.log('journal-write-path guard OK')
process.exit(0)
