/**
 * `runDefaultsInstall` smoke — uses a fake modules tree under tmpdir to
 * verify skill files are copied idempotently and re-runs are no-ops.
 *
 * Agent + schedule installation paths require real services and are
 * exercised end-to-end via the CLI smoke test in §12.6.
 */

import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { runDefaultsInstall } from './install-defaults'

const previousCwd = process.cwd()

function makeTemplateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vobase-defaults-test-'))
  mkdirSync(join(root, 'modules', 'foo', 'defaults'), { recursive: true })
  mkdirSync(join(root, 'modules', 'foo', 'skills'), { recursive: true })
  return root
}

beforeEach(() => {
  process.chdir(previousCwd)
})

afterEach(() => {
  process.chdir(previousCwd)
})

describe('runDefaultsInstall', () => {
  it('copies a *.skill.md default into the module skills/ dir on first run', async () => {
    const root = makeTemplateRoot()
    await Bun.write(join(root, 'modules', 'foo', 'defaults', 'sample.skill.md'), '---\nname: sample\n---\n\n# Sample\n')
    process.chdir(root)
    const result = await runDefaultsInstall({ upgrade: false, prune: false })
    expect(result.installed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.entries).toEqual([{ module: 'foo', kind: 'skill', source: 'sample.skill.md', status: 'installed' }])
    const installed = await Bun.file(join(root, 'modules', 'foo', 'skills', 'sample.md')).text()
    expect(installed).toContain('# Sample')
  })

  it('is idempotent — re-running without --upgrade leaves existing skill files alone', async () => {
    const root = makeTemplateRoot()
    await Bun.write(
      join(root, 'modules', 'foo', 'defaults', 'sample.skill.md'),
      '---\nname: sample\n---\n\n# Original\n',
    )
    process.chdir(root)
    await runDefaultsInstall({ upgrade: false, prune: false })

    // The user has since edited the local skill file.
    await Bun.write(join(root, 'modules', 'foo', 'skills', 'sample.md'), '# Edited locally\n')

    const result = await runDefaultsInstall({ upgrade: false, prune: false })
    expect(result.installed).toBe(0)
    expect(result.skipped).toBe(1)
    const after = await Bun.file(join(root, 'modules', 'foo', 'skills', 'sample.md')).text()
    expect(after).toBe('# Edited locally\n')
  })

  it('re-applies file content under --upgrade', async () => {
    const root = makeTemplateRoot()
    await Bun.write(join(root, 'modules', 'foo', 'defaults', 'sample.skill.md'), '---\nname: sample\n---\n\n# v2\n')
    await Bun.write(join(root, 'modules', 'foo', 'skills', 'sample.md'), '# v1\n')
    process.chdir(root)
    const result = await runDefaultsInstall({ upgrade: true, prune: false })
    expect(result.installed).toBe(1)
    const after = await Bun.file(join(root, 'modules', 'foo', 'skills', 'sample.md')).text()
    expect(after).toContain('# v2')
  })
})
