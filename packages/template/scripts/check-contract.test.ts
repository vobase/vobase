import { describe, expect, test } from 'bun:test'

import type { SpawnFn } from './check-contract'
import { checkViolations, findContractFiles, gitDiffFiles, modifiedFilesFromDiff } from './check-contract'

// ---------------------------------------------------------------------------
// findContractFiles
// ---------------------------------------------------------------------------

describe('findContractFiles', () => {
  test('returns files from grep stdout', () => {
    const spawn: SpawnFn = (_cmd, _args, _cwd) => ({
      stdout: './modules/integrations/service/handshake.ts\n./modules/integrations/service/vault.ts\n',
      stderr: '',
      exitCode: 0,
    })
    expect(findContractFiles('/repo', spawn)).toEqual([
      './modules/integrations/service/handshake.ts',
      './modules/integrations/service/vault.ts',
    ])
  })

  test('returns empty array when grep finds nothing (exit 1, empty stdout)', () => {
    const spawn: SpawnFn = (_cmd, _args, _cwd) => ({
      stdout: '',
      stderr: '',
      exitCode: 1,
    })
    expect(findContractFiles('/repo', spawn)).toEqual([])
  })

  test('filters out blank lines', () => {
    const spawn: SpawnFn = (_cmd, _args, _cwd) => ({
      stdout: '\n./modules/integrations/service/handshake.ts\n\n',
      stderr: '',
      exitCode: 0,
    })
    expect(findContractFiles('/repo', spawn)).toEqual(['./modules/integrations/service/handshake.ts'])
  })
})

// ---------------------------------------------------------------------------
// gitDiffFiles
// ---------------------------------------------------------------------------

describe('gitDiffFiles', () => {
  test('returns stdout from git diff', () => {
    const spawn: SpawnFn = (cmd, args, _cwd) => {
      expect(cmd).toBe('git')
      expect(args[0]).toBe('diff')
      return {
        stdout: 'diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n',
        stderr: '',
        exitCode: 0,
      }
    }
    const result = gitDiffFiles('/repo', ['./foo.ts'], spawn)
    expect(result).toContain('+++ b/foo.ts')
  })

  test('returns empty string when files list is empty', () => {
    const spawn: SpawnFn = () => ({
      stdout: 'should not be called',
      stderr: '',
      exitCode: 0,
    })
    expect(gitDiffFiles('/repo', [], spawn)).toBe('')
  })

  test('returns empty string on git error (no remote)', () => {
    const spawn: SpawnFn = () => ({
      stdout: '',
      stderr: 'fatal: no such ref',
      exitCode: 128,
    })
    expect(gitDiffFiles('/repo', ['./foo.ts'], spawn)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// modifiedFilesFromDiff
// ---------------------------------------------------------------------------

describe('modifiedFilesFromDiff', () => {
  test('extracts target file paths from unified diff', () => {
    const diff = [
      'diff --git a/modules/integrations/service/handshake.ts b/modules/integrations/service/handshake.ts',
      '--- a/modules/integrations/service/handshake.ts',
      '+++ b/modules/integrations/service/handshake.ts',
      '@@ -1,3 +1,4 @@',
      '+/** @contract platform-tenant-v1 */',
    ].join('\n')
    const modified = modifiedFilesFromDiff(diff)
    expect(modified.has('modules/integrations/service/handshake.ts')).toBe(true)
  })

  test('handles multiple files', () => {
    const diff = ['+++ b/contracts/version.ts', '+++ b/modules/integrations/service/vault.ts'].join('\n')
    const modified = modifiedFilesFromDiff(diff)
    expect(modified.has('contracts/version.ts')).toBe(true)
    expect(modified.has('modules/integrations/service/vault.ts')).toBe(true)
  })

  test('empty diff returns empty set', () => {
    expect(modifiedFilesFromDiff('').size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// checkViolations
// ---------------------------------------------------------------------------

describe('checkViolations', () => {
  const nocover = (_file: string, _version: string) => false
  const covers = (_file: string, _version: string) => true

  test('no modified contract files -> no violations', () => {
    const violations = checkViolations([], false, false, 'v1', nocover)
    expect(violations).toEqual([])
  })

  test('modified contract files + version.ts bumped -> no violations', () => {
    const violations = checkViolations(
      ['modules/integrations/service/handshake.ts'],
      true, // versionTsModified
      false,
      'v2',
      nocover,
    )
    expect(violations).toEqual([])
  })

  test('modified contract files + CONTRACTS.md covers file -> no violations', () => {
    const violations = checkViolations(
      ['modules/integrations/service/handshake.ts'],
      false,
      true, // contractsMdModified
      'v1',
      covers,
    )
    expect(violations).toEqual([])
  })

  test('modified contract files, neither version.ts nor CONTRACTS.md updated -> violation', () => {
    const violations = checkViolations(['modules/integrations/service/handshake.ts'], false, false, 'v1', nocover)
    expect(violations.length).toBe(1)
    expect(violations[0].file).toBe('modules/integrations/service/handshake.ts')
    expect(violations[0].reason).toContain('contracts/version.ts was not bumped')
  })

  test('modified contract files, CONTRACTS.md updated but does not cover file -> violation', () => {
    const violations = checkViolations(
      ['modules/integrations/service/handshake.ts'],
      false,
      true, // contractsMdModified
      'v1',
      nocover, // doesn't cover the file
    )
    expect(violations.length).toBe(1)
    expect(violations[0].reason).toContain('does not cover')
  })

  test('multiple contract files, only some covered -> only uncovered violations', () => {
    const coveredFile = 'modules/integrations/service/vault.ts'
    const violations = checkViolations(
      ['modules/integrations/service/vault.ts', 'modules/integrations/service/verify-token.ts'],
      false,
      true,
      'v1',
      (file, _version) => file === coveredFile,
    )
    expect(violations.length).toBe(1)
    expect(violations[0].file).toBe('modules/integrations/service/verify-token.ts')
  })

  test('contracts/version.ts not yet present (null) + modified files -> violation with unknown version', () => {
    const violations = checkViolations(
      ['modules/integrations/service/handshake.ts'],
      false,
      true,
      null, // version not yet present
      nocover,
    )
    expect(violations.length).toBe(1)
    expect(violations[0].reason).toContain('unknown')
  })
})
