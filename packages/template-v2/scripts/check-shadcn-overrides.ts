#!/usr/bin/env bun
/**
 * CI gate — installed registry files must match components.lock.json SHAs.
 * hand_written entries are skipped. Drift is allowed only if file has // shadcn-override-ok: sentinel.
 * allowed_overrides entries must have their sentinel present.
 * Exit 0 = clean. Exit 1 = violations found.
 */

import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const LOCK_FILE = join(ROOT, 'components.lock.json')
const SENTINEL = '// shadcn-override-ok:'

interface LockEntry {
  component: string
  file: string
  sha256_of_installed_file: string
  hand_written?: boolean
}
interface AllowedOverride {
  file: string
  sentinel: string
}
interface LockFile {
  components: LockEntry[]
  allowed_overrides: AllowedOverride[]
}

function sha256hex(content: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(content)
  return hasher.digest('hex')
}

// --- self-test ---
const _known = sha256hex('hello')
if (_known !== '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824') {
  throw new Error('check-shadcn-overrides: SHA256 self-test failed')
}

// --- real check ---
const lock: LockFile = JSON.parse(await Bun.file(LOCK_FILE).text())
const errors: string[] = []

for (const entry of lock.components) {
  if (entry.hand_written) continue // hand-written-to-spec; no drift check

  const filePath = join(ROOT, entry.file)
  const fileObj = Bun.file(filePath)
  if (!(await fileObj.exists())) {
    errors.push(`${entry.file}: component file missing (listed in components.lock.json but not installed)`)
    continue
  }

  const content = await fileObj.text()
  const actual = sha256hex(content)
  if (actual === entry.sha256_of_installed_file) continue

  // Drift — check for sentinel
  if (!content.includes(SENTINEL)) {
    errors.push(
      `${entry.file}: SHA mismatch (installed file drifted from lock). ` +
        `Add "${SENTINEL} <reason>" to allow, or re-snapshot via scripts/refresh-component-locks.ts`,
    )
  }
}

// allowed_overrides: verify sentinel present
for (const override of lock.allowed_overrides) {
  const filePath = join(ROOT, override.file)
  const fileObj = Bun.file(filePath)
  if (!(await fileObj.exists())) continue
  const content = await fileObj.text()
  if (!content.includes(SENTINEL)) {
    errors.push(`${override.file}: listed in allowed_overrides but missing "${SENTINEL}" sentinel comment`)
  }
}

if (errors.length === 0) {
  console.log('[check:shadcn-overrides] ✓ All registry components match lock SHAs')
  process.exit(0)
}

console.error('[check:shadcn-overrides] ✗ Override violations:\n')
for (const e of errors) console.error(`  ${e}`)
process.exit(1)
