#!/usr/bin/env bun
/**
 * CI lint — trust-bearing input fields must not carry literal defaults.
 *
 * Background: the phone-hallucination bug from 2026-05 traced to a CLI verb
 * declaring `confidence: z.number().default(1.0)` in its Zod input schema.
 * When the agent invoked the verb without an explicit `--confidence`, the
 * schema substituted 1.0, exceeding the auto-apply bar for high-sensitivity
 * fields (phone, email) and quietly auto-writing fabricated values.
 *
 * Rule: trust-bearing inputs (`confidence`, `severity`, `priority`,
 * `sensitivity`, `autoApply` / `auto_apply`) must NEVER carry a literal
 * default in their Zod schema. They must be derived in the verb body from
 * `ctx.principal` (kind=user → undefined/highest, kind=agent → conservative
 * baseline).
 *
 * Scope: every CLI verb shape — `modules/*\/cli.ts`, `modules/*\/verbs/**\/*.ts`,
 * and any `*-handler.ts` that defines a Zod input schema. Skips test files.
 */
import { join } from 'node:path'

const TEMPLATE_ROOT = join(import.meta.dir, '..')
const MODULES_DIR = join(TEMPLATE_ROOT, 'modules')

interface LintError {
  file: string
  line: number
  field: string
  snippet: string
}

const errors: LintError[] = []

const TRUST_FIELDS = ['confidence', 'severity', 'priority', 'sensitivity', 'autoApply', 'auto_apply'] as const

/**
 * Match a property declaration like:
 *   confidence: z.number().min(0).max(1).default(1.0)
 *   confidence: z.number().default(0.95)
 *   severity: z.enum([...]).default('high')
 *
 * The `.default(...)` call is what we forbid for trust fields. Any chain
 * length is matched — the regex anchors on `<field>:` then looks ahead for
 * `.default(` somewhere on the same line.
 *
 * `<field>` must be a top-level property name (no preceding word char), so
 * `selfConfidence: z.number().default(0)` is intentionally NOT matched —
 * we only flag the canonical trust property names.
 */
function buildRegex(field: string): RegExp {
  // Word-boundary before, colon after — matches at start of line (with indent)
  // or right after `{ `, but not after `someConfidenceProp:` etc.
  return new RegExp(`(^|[\\s,{])(${field})\\s*:[^\\n]*\\.default\\s*\\(`)
}

const RES = TRUST_FIELDS.map((f) => ({ field: f, re: buildRegex(f) }))

async function checkFile(absPath: string, relPath: string): Promise<void> {
  const text = await Bun.file(absPath).text()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
    for (const { field, re } of RES) {
      if (re.test(line)) {
        errors.push({ file: relPath, line: i + 1, field, snippet: line.trim() })
      }
    }
  }
}

async function main(): Promise<void> {
  // Scan every .ts under modules/, excluding tests + generated.
  const glob = new Bun.Glob('**/*.ts')
  for await (const entry of glob.scan({ cwd: MODULES_DIR })) {
    if (entry.endsWith('.test.ts')) continue
    if (entry.includes('__tests__/')) continue
    if (entry.endsWith('.generated.ts')) continue
    await checkFile(join(MODULES_DIR, entry), `modules/${entry}`)
  }

  if (errors.length > 0) {
    console.error('\ncheck-trust-defaults: FAILED\n')
    console.error('Trust-bearing inputs must NOT carry literal `.default(...)` values.')
    console.error('Derive them from `ctx.principal` in the verb body instead.')
    console.error('See: packages/template/modules/contacts/cli.ts (effectiveConfidence pattern)\n')
    for (const err of errors) {
      console.error(`  ${err.file}:${err.line}: \`${err.field}\` has a literal default`)
      console.error(`    ${err.snippet}`)
    }
    console.error(`\n${errors.length} violation(s) found.`)
    process.exit(1)
  }

  console.log('check-trust-defaults: OK')
  process.exit(0)
}

await main()
