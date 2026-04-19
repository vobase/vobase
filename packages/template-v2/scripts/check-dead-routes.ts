#!/usr/bin/env bun
/**
 * CI gate — legacy conversation.$id.tsx must not exist; no orphaned page files outside routes.ts.
 * Exit 0 = clean. Exit 1 = violations found.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const ROUTES_FILE = join(ROOT, 'src/routes.ts')
const LEGACY_PAGE = join(ROOT, 'src/pages/conversation.$id.tsx')

const errors: string[] = []

// --- self-test ---
const _legacyRe = /conversation\.\$id/
const _tests = [
  { src: "import { ConversationPage } from './pages/conversation.$id'", expect: true },
  { src: "import { InboxPage } from './pages/inbox'", expect: false },
]
for (const t of _tests) {
  if (_legacyRe.test(t.src) !== t.expect) throw new Error(`check-dead-routes self-test failed: ${t.src}`)
}

// --- real checks ---

// 1. Legacy file must not exist (Parcel R deletes it)
if (existsSync(LEGACY_PAGE)) {
  errors.push(`${LEGACY_PAGE}: legacy conversation.$id.tsx still exists — Parcel R must delete it`)
}

// 2. routes.ts must not reference the legacy path
if (existsSync(ROUTES_FILE)) {
  const routes = await Bun.file(ROUTES_FILE).text()
  if (_legacyRe.test(routes)) {
    errors.push(`${ROUTES_FILE}: routes.ts still references conversation.$id — update to nested inbox routes (Parcel R)`)
  }
}

// 3. Check for any src/pages/** files not reachable from routes.ts (simple orphan check)
if (existsSync(ROUTES_FILE)) {
  const routes = await Bun.file(ROUTES_FILE).text()
  const pagesGlob = new Bun.Glob('src/pages/**/*.tsx')
  for (const file of pagesGlob.scanSync({ cwd: ROOT })) {
    if (file.includes('.test.')) continue
    const basename = file.replace(/^src\/pages\//, '').replace(/\.tsx$/, '')
    // Rough check: basename (without extension) should appear in routes.ts
    const slug = basename.replace(/\.\$[^.]+/g, '') // strip param segments like .$id
    if (!routes.includes(slug.replace(/\//g, ''))) {
      errors.push(`${file}: page file not referenced in routes.ts (possible orphan)`)
    }
  }
}

if (errors.length === 0) {
  console.log('[check:dead-routes] ✓ No dead routes or orphaned pages found')
  process.exit(0)
}

console.error('[check:dead-routes] ✗ Dead route violations:\n')
for (const e of errors) console.error(`  ${e}`)
process.exit(1)
