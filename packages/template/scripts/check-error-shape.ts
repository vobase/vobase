#!/usr/bin/env bun
/**
 * CI lint — verb returns must not echo raw pg error details to callers.
 *
 * Background: the cross-account leak from 2026-05 happened because a verb
 * caught a 23505 (unique_conflict) and forwarded the raw `cause.detail`
 * (e.g. "Key (organization_id, …)=(mer0tenant, contacts, contact, ctt0…)
 * already exists.") into the agent-visible `error:` string. The detail
 * contained the conflicting row's foreign org/account id — a privacy
 * disclosure across tenant boundaries.
 *
 * Rule: in CLI verb files (`modules/*\/cli.ts` and `modules/*\/verbs/**\/*.ts`):
 *   - Object property `error:` MUST NOT include `cause.detail`, `cause.message`,
 *     `pg.detail`, or `pg.message` — those carry pg's verbatim conflict
 *     descriptions including row data.
 *   - Object property `data:` MUST NOT pass the bare `cause` or `pg` identifier
 *     — that ships the entire pg error object back through the wire.
 *
 * Pattern (canonical, in `modules/contacts/cli.ts`):
 *
 *   if (pg?.code === '23505') {
 *     return {
 *       ok: false as const,
 *       error: 'That value cannot be set on this contact. Ask the customer …',
 *       errorCode: 'unique_conflict',
 *       data: { constraint: pg.constraint },         //   ← only the constraint name
 *     }
 *   }
 *
 * Allowed: `error: err.message` (drizzle's wrapper message is generic enough
 * to leak only the table/operation, never row contents — and removing it
 * makes debugging unreachable). The lint focuses on the raw pg fields that
 * historically caused the leak.
 */
import { join } from 'node:path'

const TEMPLATE_ROOT = join(import.meta.dir, '..')
const MODULES_DIR = join(TEMPLATE_ROOT, 'modules')

interface LintError {
  file: string
  line: number
  message: string
  snippet: string
}

const errors: LintError[] = []

/**
 * Forbidden references inside a value bound to `error:` on the same line.
 * Any of these means raw pg row data is being shipped to the caller.
 */
const FORBIDDEN_IN_ERROR_VALUE: readonly RegExp[] = [
  /\bcause\??\.detail\b/,
  /\bcause\??\.message\b/,
  /\bpg\??\.detail\b/,
  /\bpg\??\.message\b/,
]

/**
 * Forbidden bare-identifier passthroughs in `data:`. Anything spreading or
 * passing the whole error object is a leak; let only explicit field selection
 * through (`data: { constraint: pg.constraint }`).
 */
const FORBIDDEN_DATA_BARE: readonly RegExp[] = [
  /\bdata\s*:\s*pg\b\s*[,}\n)]/,
  /\bdata\s*:\s*cause\b\s*[,}\n)]/,
  /\bdata\s*:\s*\.{3}pg\b/,
  /\bdata\s*:\s*\.{3}cause\b/,
]

/** True if the file is a CLI verb file we care about. */
function isVerbFile(rel: string): boolean {
  if (rel.endsWith('.test.ts')) return false
  if (rel.endsWith('cli.ts')) return true
  if (rel.includes('/verbs/')) return true
  return false
}

async function checkFile(absPath: string, relPath: string): Promise<void> {
  const text = await Bun.file(absPath).text()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue

    // `error:` value passthroughs — line must contain `error:` AND one of the
    // forbidden references in the same line.
    if (/\berror\s*:/.test(line)) {
      for (const re of FORBIDDEN_IN_ERROR_VALUE) {
        if (re.test(line)) {
          errors.push({
            file: relPath,
            line: i + 1,
            message: `\`error:\` must not echo raw pg fields (${re.source}) — sanitize to a neutral message + \`errorCode:\``,
            snippet: line.trim(),
          })
          break
        }
      }
    }

    // `data:` bare-identifier passthroughs.
    for (const re of FORBIDDEN_DATA_BARE) {
      if (re.test(line)) {
        errors.push({
          file: relPath,
          line: i + 1,
          message: `\`data:\` must not pass the bare pg/cause object — pick explicit fields (e.g. \`data: { constraint: pg.constraint }\`)`,
          snippet: line.trim(),
        })
        break
      }
    }
  }
}

async function main(): Promise<void> {
  const glob = new Bun.Glob('**/*.ts')
  for await (const entry of glob.scan({ cwd: MODULES_DIR })) {
    if (!isVerbFile(entry)) continue
    await checkFile(join(MODULES_DIR, entry), `modules/${entry}`)
  }

  if (errors.length > 0) {
    console.error('\ncheck-error-shape: FAILED\n')
    console.error('CLI verb returns must not echo raw pg error fields to callers.')
    console.error('See: packages/template/modules/contacts/cli.ts (23505 handling pattern)\n')
    for (const err of errors) {
      console.error(`  ${err.file}:${err.line}: ${err.message}`)
      console.error(`    ${err.snippet}`)
    }
    console.error(`\n${errors.length} violation(s) found.`)
    process.exit(1)
  }

  console.log('check-error-shape: OK')
  process.exit(0)
}

await main()
