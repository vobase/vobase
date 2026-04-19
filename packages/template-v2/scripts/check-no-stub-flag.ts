#!/usr/bin/env bun
/**
 * CI gate — zero matches of VITE_INBOX_STUB_ENDPOINTS in src/**.
 * Per A5: stub flag must be fully removed before PR-1 merge.
 * No sentinel; this flag must be entirely absent at merge.
 * Exit 0 = clean. Exit 1 = violations found.
 */

// --- self-test ---
const STUB_FLAG = 'VITE_INBOX_STUB_ENDPOINTS'
const _tests = [
  { src: "if (import.meta.env.VITE_INBOX_STUB_ENDPOINTS === 'true')", expect: true },
  { src: "const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'", expect: false },
]
for (const t of _tests) {
  if (t.src.includes(STUB_FLAG) !== t.expect) throw new Error(`check-no-stub-flag self-test failed: ${t.src}`)
}

// --- real scan ---
const glob = new Bun.Glob('src/**/*.{ts,tsx}')
const violations: Array<{ file: string; line: number; text: string }> = []

for (const file of glob.scanSync({ cwd: `${import.meta.dir}/..` })) {
  const content = await Bun.file(`${import.meta.dir}/../${file}`).text()
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    if (raw.includes(STUB_FLAG)) violations.push({ file, line: i + 1, text: raw.trim() })
  }
}

if (violations.length === 0) {
  console.log('[check:no-stub-flag] ✓ No VITE_INBOX_STUB_ENDPOINTS references in src/')
  process.exit(0)
}

console.error('[check:no-stub-flag] ✗ Stub flag still present (must be removed before PR-1 merge):\n')
for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
process.exit(1)
