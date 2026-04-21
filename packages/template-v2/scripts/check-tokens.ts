#!/usr/bin/env bun
/**
 * CI gate — no raw hex/oklch in src/**\/*.{ts,tsx}; RelativeTimeCard must be the only date renderer.
 * Exit 0 = clean. Exit 1 = violations found.
 */

// Hex inside quotes or Tailwind arbitrary: `'#abc'`, `bg-[#0b0b0b]`
const HEX_RE = /(['"`]#[0-9a-fA-F]{3,8}['"`]|\[#[0-9a-fA-F]{3,8}\])/
// SVG paint attributes — brand-mark logos carry official hex colors that can't be tokenized.
// Exempts: fill="#...", stroke="#...", stop-color="#...", flood-color="#...", lighting-color="#..."
const SVG_PAINT_RE = /\b(fill|stroke|stop-color|flood-color|lighting-color)="#[0-9a-fA-F]{3,8}"/
// Inline oklch() outside of comments
const OKLCH_RE = /oklch\(/
// Date formatting calls that bypass RelativeTimeCard
const DATE_RENDERER_RE = /\.(toLocaleDateString|toLocaleTimeString|toLocaleString)\(|formatDate\(|formatRelativeTime\(/

const DATE_EXEMPT = new Set([
  'src/components/ui/relative-time.tsx',
  'src/components/ui/relative-time-card.tsx',
  'src/components/ui/calendar.tsx',
  'src/components/data-table/data-table-date-filter.tsx',
  'src/components/data-table/data-table-slider-filter.tsx',
  'src/lib/format.ts',
  'src/lib/utils.ts', // defines formatRelativeTime; Parcel S removes it
])

// --- self-test ---
const _selfTests: Array<{ line: string; re: RegExp; expect: boolean }> = [
  { line: "color: '#0b0b0b'", re: HEX_RE, expect: true },
  { line: 'bg-[#1a1a1a]', re: HEX_RE, expect: true },
  { line: "color: 'var(--color-fg)'", re: HEX_RE, expect: false },
  { line: '<path fill="#4285F4" />', re: SVG_PAINT_RE, expect: true },
  { line: '<rect fill="#F25022" />', re: SVG_PAINT_RE, expect: true },
  { line: 'stroke="#fff"', re: SVG_PAINT_RE, expect: true },
  { line: "color: '#abc'", re: SVG_PAINT_RE, expect: false },
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

    if (HEX_RE.test(raw) && !SVG_PAINT_RE.test(raw)) violations.push({ file, line: i + 1, text: raw.trim() })
    else if (OKLCH_RE.test(raw)) violations.push({ file, line: i + 1, text: raw.trim() })
    else if (!isDateExempt && DATE_RENDERER_RE.test(raw)) violations.push({ file, line: i + 1, text: raw.trim() })
  }
}

if (violations.length > 0) {
  console.error('[check:tokens] ✗ Raw-color / date-renderer violations found:\n')
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
  process.exit(1)
}
console.log('[check:tokens] ✓ No raw colors or date-renderer violations in src/')

// --- two-palette coverage check ---
const CSS_PATH = `${import.meta.dir}/../src/styles/app.css`
const cssContent = await Bun.file(CSS_PATH).text()

function extractPaletteTokens(css: string, selectorRe: RegExp): Set<string> {
  const idx = css.search(selectorRe)
  if (idx === -1) return new Set()
  const blockStart = css.indexOf('{', idx)
  if (blockStart === -1) return new Set()
  let depth = 1
  let pos = blockStart + 1
  while (pos < css.length && depth > 0) {
    if (css[pos] === '{') depth++
    else if (css[pos] === '}') depth--
    pos++
  }
  const block = css.slice(blockStart + 1, pos - 1)
  const tokens = new Set<string>()
  for (const m of block.matchAll(/--(color-[a-z0-9-]+)\s*:/g)) tokens.add(`--${m[1]}`)
  return tokens
}

const lightTokens = extractPaletteTokens(cssContent, /^:root\s*\{/m)
const darkTokens = extractPaletteTokens(cssContent, /^\.dark\s*\{/m)
// @theme inline tokens are mode-neutral (resolved by Tailwind at build time); treat as defined in both
const themeInlineTokens = extractPaletteTokens(cssContent, /@theme\s+inline\s*\{/)
for (const t of themeInlineTokens) {
  lightTokens.add(t)
  darkTokens.add(t)
}

// Collect all var(--color-*) references used in src/**
const usedTokens = new Set<string>()
const srcCssGlob = new Bun.Glob('src/**/*.{ts,tsx,css}')
for (const file of srcCssGlob.scanSync({ cwd: `${import.meta.dir}/..` })) {
  const content = await Bun.file(`${import.meta.dir}/../${file}`).text()
  for (const m of content.matchAll(/var\(--(color-[a-z0-9-]+)\)/g)) usedTokens.add(`--${m[1]}`)
}

const paletteViolations: string[] = []
for (const t of [...lightTokens].filter((t) => !darkTokens.has(t)))
  paletteViolations.push(`  ${t}: in :root (light) but missing from .dark`)
for (const t of [...darkTokens].filter((t) => !lightTokens.has(t)))
  paletteViolations.push(`  ${t}: in .dark but missing from :root (light)`)
for (const t of usedTokens) {
  if (!lightTokens.has(t)) paletteViolations.push(`  ${t}: used in src/** but missing from :root (light)`)
  if (!darkTokens.has(t)) paletteViolations.push(`  ${t}: used in src/** but missing from .dark`)
}

if (paletteViolations.length > 0) {
  console.error('[check:tokens] ✗ Palette coverage violations:\n')
  for (const v of paletteViolations) console.error(v)
  process.exit(1)
}
console.log('[check:tokens] ✓ Both palettes cover all var(--color-*) token references')
process.exit(0)
