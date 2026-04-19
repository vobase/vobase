#!/usr/bin/env bun
/**
 * CI gate — no header tabs auto-derived from sidebar nav config (the v1 sin).
 * Scans src/components/layout/**\/*.{ts,tsx} and src/routes.ts.
 * Allow-list: // nav-tabs-ok: <reason>
 * Exit 0 = clean. Exit 1 = violations found.
 */

import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SENTINEL = '// nav-tabs-ok:'

// Detects mapping over nav/sidebar/route arrays to render tabs
const AUTO_NAV_TABS_RE =
  /\b(navItems|sidebarItems|navLinks|navigation|routeList|sidebarNav)\s*\.\s*map\s*\(/

// --- self-test ---
const _tests = [
  { src: 'navItems.map(item => <Tab>{item.label}</Tab>)', expect: true },
  { src: 'sidebarItems.map((i) => <TabsTrigger key={i.id}>', expect: true },
  { src: 'conversations.map(conv => <Row key={conv.id}>', expect: false },
  { src: 'filters.map(f => <Chip key={f}>', expect: false },
]
for (const t of _tests) {
  if (AUTO_NAV_TABS_RE.test(t.src) !== t.expect)
    throw new Error(`check-no-auto-nav-tabs self-test failed: ${t.src}`)
}

// --- real scan ---
const targets: string[] = []
const layoutGlob = new Bun.Glob('src/components/layout/**/*.{ts,tsx}')
for (const f of layoutGlob.scanSync({ cwd: ROOT })) targets.push(f)
targets.push('src/routes.ts')

const violations: Array<{ file: string; line: number; text: string }> = []

for (const rel of targets) {
  const path = join(ROOT, rel)
  if (!(await Bun.file(path).exists())) continue
  const content = await Bun.file(path).text()

  // If file has a file-level sentinel, skip entirely
  if (content.includes(SENTINEL)) continue

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    if (raw.includes(SENTINEL)) continue
    if (AUTO_NAV_TABS_RE.test(raw)) {
      violations.push({ file: rel, line: i + 1, text: raw.trim() })
    }
  }
}

if (violations.length === 0) {
  console.log('[check:no-auto-nav-tabs] ✓ No auto-derived nav tabs found')
  process.exit(0)
}

console.error('[check:no-auto-nav-tabs] ✗ Auto-derived nav tab violations:\n')
for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
process.exit(1)
