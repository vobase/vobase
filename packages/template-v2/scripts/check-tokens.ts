#!/usr/bin/env bun
/**
 * CI gate — no raw hex/oklch in src/**\/*.{ts,tsx}; RelativeTimeCard must be the only date renderer.
 * Exit 0 = clean. Exit 1 = violations found.
 */

// Hex inside quotes or Tailwind arbitrary: `'#abc'`, `bg-[#0b0b0b]`
const HEX_RE = /(['"`]#[0-9a-fA-F]{3,8}['"`]|\[#[0-9a-fA-F]{3,8}\])/
// Inline oklch() outside of comments
const OKLCH_RE = /oklch\(/
// Date formatting calls that bypass RelativeTimeCard
const DATE_RENDERER_RE = /\.(toLocaleDateString|toLocaleTimeString|toLocaleString)\(|formatDate\(|formatRelativeTime\(/

const DATE_EXEMPT = new Set([
  'src/components/ui/relative-time.tsx',
  'src/components/ui/relative-time-card.tsx',
  'src/lib/format.ts',
  'src/lib/utils.ts', // defines formatRelativeTime; Parcel S removes it
])

// --- self-test ---
const _selfTests: Array<{ line: string; re: RegExp; expect: boolean }> = [
  { line: "color: '#0b0b0b'", re: HEX_RE, expect: true },
  { line: 'bg-[#1a1a1a]', re: HEX_RE, expect: true },
  { line: "color: 'var(--color-fg)'", re: HEX_RE, expect: false },
  { line: 'oklch(0.5 0.1 240)', re: OKLCH_RE, expect: true },
  { line: '// some comment without oklch paren', re: OKLCH_RE, expect: false },
  { line: 'someDate.toLocaleDateString()', re: DATE_RENDERER_RE, expect: true },
  { line: '<RelativeTimeCard date={d} />', re: DATE_RENDERER_RE, expect: false },
]
for (const t of _selfTests) {
  if (t.re.test(t.line) !== t.expect) throw new Error(`check-tokens self-test failed: ${t.line}`)
}

// --- real scan ---
const glob = new Bun.Glob('src/**/*.{ts,tsx}')
const violations: Array<{ file: string; line: number; text: string }> = []

for (const file of glob.scanSync({ cwd: `${import.meta.dir}/..` })) {
  const content = await Bun.file(`${import.meta.dir}/../${file}`).text()
  const lines = content.split('\n')
  const isDateExempt = DATE_EXEMPT.has(file)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    if (HEX_RE.test(raw)) violations.push({ file, line: i + 1, text: raw.trim() })
    else if (OKLCH_RE.test(raw)) violations.push({ file, line: i + 1, text: raw.trim() })
    else if (!isDateExempt && DATE_RENDERER_RE.test(raw)) violations.push({ file, line: i + 1, text: raw.trim() })
  }
}

if (violations.length === 0) {
  console.log('[check:tokens] ✓ No raw colors or date-renderer violations in src/')
  process.exit(0)
}

console.error('[check:tokens] ✗ Violations found:\n')
for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
process.exit(1)
