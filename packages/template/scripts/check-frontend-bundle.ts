/**
 * CI gate — fails if any src/**\/*.{ts,tsx} file contains a runtime import of
 * `~/wake/*` or `~/runtime`. These pull in pg-boss, pi-agent-core, and
 * drizzle runtime — they must never enter the Vite bundle.
 *
 * `import type` statements are allowed (Vite strips them at build time) but
 * this script bans them too as a conservative safety measure: if a file
 * needs types from those paths, it should go through narrower non-runtime
 * modules (e.g. `~/wake/events`, `@vobase/core`) instead.
 *
 * Exit 0 = clean. Exit 1 = violations found.
 */

import { readFileSync } from 'node:fs'

/**
 * `BANNED` lists path/module fragments any of which appears in an `import`
 * statement is a frontend-bundle leak. Includes `~/wake/*` + `~/runtime`
 * (server runtime), heavy backend deps that must never enter Vite, and the
 * drive backend libs that lazy-import those deps under the hood.
 */
const BANNED = [
  '~/wake',
  '~/runtime',
  // Heavy server-only deps — would balloon the Vite bundle.
  'mammoth',
  'xlsx',
  'officeparser',
  '@hyzyla/pdfium',
  'sharp',
  '@ai-sdk/openai',
  // Drive backend libs that lazy-import the heavy deps above.
  '@modules/drive/lib/embeddings',
  '@modules/drive/lib/ocr-provider',
  '@modules/drive/lib/extract',
  '@modules/drive/lib/search',
]
const FRONTEND_GLOBS = [
  'src/**/*.{ts,tsx}',
  'modules/*/pages/**/*.{ts,tsx}',
  'modules/*/components/**/*.{ts,tsx}',
  'modules/*/hooks/**/*.{ts,tsx}',
]

const violations: Array<{ file: string; line: number; text: string }> = []

for (const pattern of FRONTEND_GLOBS) {
  const glob = new Bun.Glob(pattern)
  for (const file of glob.scanSync({ cwd: `${import.meta.dir}/..` })) {
    const content = readFileSync(`${import.meta.dir}/../${file}`, 'utf8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const trimmed = line.trim()
      if (!trimmed.startsWith('import')) continue
      for (const banned of BANNED) {
        if (trimmed.includes(`'${banned}`) || trimmed.includes(`"${banned}`)) {
          violations.push({ file, line: i + 1, text: trimmed })
        }
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✓ No forbidden server imports in src/')
  process.exit(0)
}

console.error('✗ Forbidden imports found in src/ — these would break the Vite bundle:\n')
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`)
}
process.exit(1)
