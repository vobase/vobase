/**
 * Guard that CLI_VERSION in bin/vobase.ts stays in sync with package.json.
 * If this test fails, update the CLI_VERSION constant in bin/vobase.ts.
 */
import { describe, expect, it } from 'bun:test'

describe('CLI_VERSION sync', () => {
  it('bin/vobase.ts CLI_VERSION matches package.json version', async () => {
    // Read both files as text to avoid JSON import (tsconfig excludes package.json).
    const pkgText = await Bun.file(new URL('../package.json', import.meta.url)).text()
    const pkgVersion = (JSON.parse(pkgText) as { version: string }).version

    const src = await Bun.file(new URL('../bin/vobase.ts', import.meta.url)).text()
    const match = src.match(/const CLI_VERSION\s*=\s*'([^']+)'/)
    expect(match, 'CLI_VERSION constant not found in bin/vobase.ts').toBeTruthy()
    expect(match?.[1]).toBe(pkgVersion)
  })
})
