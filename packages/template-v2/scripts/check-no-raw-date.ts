#!/usr/bin/env bun
/**
 * CI gate — no raw date formatting in PR-changed source files.
 * Scoped to git diff from origin/main..HEAD so pre-existing code isn't flagged.
 * Exit 0 = clean. Exit 1 = violations found.
 */

const RAW_DATE_RE = /new\s+Date\(\)\.toLocaleString|\.toLocaleDateString\(|\.toLocaleTimeString\(|formatRelativeTime\(/

// --- self-test ---
const _selfTests: Array<{ line: string; expect: boolean }> = [
  { line: "new Date().toLocaleString('en-SG')", expect: true },
  { line: 'date.toLocaleDateString()', expect: true },
  { line: 'date.toLocaleTimeString()', expect: true },
  { line: 'formatRelativeTime(date)', expect: true },
  { line: '<RelativeTimeCard date={d} />', expect: false },
  { line: 'intlFormatDistance(a, b)', expect: false },
]
for (const t of _selfTests) {
  if (RAW_DATE_RE.test(t.line) !== t.expect) throw new Error(`check-no-raw-date self-test failed: ${t.line}`)
}

// --- git-diff-scoped file list ---
function spawnGit(args: string[]): { ok: boolean; out: string } {
  const result = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { ok: result.exitCode === 0, out: new TextDecoder().decode(result.stdout).trim() }
}

function getChangedFiles(): string[] {
  let base: string
  const fromOrigin = spawnGit(['merge-base', 'HEAD', 'origin/main'])
  if (fromOrigin.ok) {
    base = fromOrigin.out
  } else {
    const fromLocal = spawnGit(['merge-base', 'HEAD', 'main'])
    if (fromLocal.ok) {
      base = fromLocal.out
    } else {
      console.warn('[check:no-raw-date] Could not determine merge base; skipping.')
      process.exit(0)
    }
  }

  const diff = spawnGit(['diff', '--name-only', `${base}...HEAD`])
  return diff.out ? diff.out.split('\n') : []
}

const changed = getChangedFiles()
const srcFiles = changed.filter(
  (f) =>
    (f.startsWith('src/') || f.startsWith('modules/')) &&
    (f.endsWith('.ts') || f.endsWith('.tsx')) &&
    !f.includes('/__tests__/') &&
    !f.includes('/tests/') &&
    !f.endsWith('.test.ts') &&
    !f.endsWith('.test.tsx'),
)

if (srcFiles.length === 0) {
  console.log('[check:no-raw-date] ✓ No matching source files in PR diff')
  process.exit(0)
}

// --- scan ---
const violations: Array<{ file: string; line: number; text: string }> = []
const cwd = `${import.meta.dir}/..`

for (const file of srcFiles) {
  let content: string
  try {
    content = await Bun.file(`${cwd}/${file}`).text()
  } catch {
    continue
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    if (RAW_DATE_RE.test(raw)) violations.push({ file, line: i + 1, text: raw.trim() })
  }
}

if (violations.length === 0) {
  console.log('[check:no-raw-date] ✓ No raw date-formatter violations in PR diff')
  process.exit(0)
}

console.error('[check:no-raw-date] ✗ Raw date-formatter violations found:\n')
for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
process.exit(1)
