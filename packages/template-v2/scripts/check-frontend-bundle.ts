/**
 * CI gate — fails if any src/**\/*.{ts,tsx} file contains a runtime import of
 * @server/runtime/* or @server/harness/*. These modules pull in pg-boss,
 * pi-agent-core, and drizzle runtime — they must never enter the Vite bundle.
 *
 * `import type` statements are allowed (Vite strips them at build time) but
 * this script bans them too as a conservative safety measure: if a file needs
 * types from those paths, it should go through more specific non-runtime
 * modules (e.g. `@server/events`, `@server/common/*`, `@vobase/core`) instead.
 *
 * Exit 0 = clean. Exit 1 = violations found.
 */

import { readFileSync } from 'node:fs'

const BANNED = ['@server/runtime', '@server/harness']
const glob = new Bun.Glob('src/**/*.{ts,tsx}')

const violations: Array<{ file: string; line: number; text: string }> = []

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

if (violations.length === 0) {
  console.log('✓ No forbidden server imports in src/')
  process.exit(0)
}

console.error('✗ Forbidden imports found in src/ — these would break the Vite bundle:\n')
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`)
}
process.exit(1)
