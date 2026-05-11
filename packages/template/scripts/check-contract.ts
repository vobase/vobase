#!/usr/bin/env bun
/**
 * check:contract — US-007 / Principle 4.
 *
 * Git-diff based contract version checker.
 *
 * 1. Discovers contract files via `grep -rln '@contract platform-tenant-v1' .`
 *    (skipping node_modules + drizzle).
 * 2. Runs `git diff origin/main -- <those files>`.
 * 3. If any contract file is modified, asserts EITHER:
 *    a) `contracts/version.ts` was also modified in the same diff, OR
 *    b) `CONTRACTS.md` was also modified and its row for that file lists a
 *       version matching the exported constant in `contracts/version.ts`.
 *
 * If `contracts/version.ts` does not exist, the script has nothing to
 * enforce (US-007 creates it) and exits 0.
 *
 * Exit code 1 on violation, 0 on clean.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Result of running a git/grep subprocess. */
export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Dependency injection type for subprocess calls (enables testing). */
export type SpawnFn = (cmd: string, args: string[], cwd: string) => SpawnResult;

/** Default implementation using Bun.spawnSync. */
export function defaultSpawn(
  cmd: string,
  args: string[],
  cwd: string,
): SpawnResult {
  const proc = Bun.spawnSync([cmd, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd,
  });
  return {
    stdout: proc.stdout?.toString() ?? '',
    stderr: proc.stderr?.toString() ?? '',
    exitCode: proc.exitCode ?? 1,
  };
}

/**
 * Find files containing `@contract platform-tenant-v1`.
 * Skips node_modules and drizzle directories.
 */
export function findContractFiles(repo: string, spawn: SpawnFn): string[] {
  const result = spawn(
    'grep',
    [
      '-rln',
      '--include=*.ts',
      '--exclude-dir=node_modules',
      '--exclude-dir=drizzle',
      '@contract platform-tenant-v1',
      '.',
    ],
    repo,
  );
  if (result.exitCode !== 0 && result.stdout.trim() === '') {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Run `git diff origin/main -- <files>` and return the raw diff output.
 * Returns empty string if the git command fails (e.g. no remote).
 */
export function gitDiffFiles(
  repo: string,
  files: string[],
  spawn: SpawnFn,
): string {
  if (files.length === 0) return '';
  const result = spawn('git', ['diff', 'origin/main', '--', ...files], repo);
  if (result.exitCode !== 0) return '';
  return result.stdout;
}

/**
 * Parse which files were modified in a unified diff output.
 * Returns Set of `b/<path>` target paths (relative to repo root).
 */
export function modifiedFilesFromDiff(diff: string): Set<string> {
  const modified = new Set<string>();
  for (const line of diff.split('\n')) {
    // `+++ b/path/to/file.ts` marks the target file in a unified diff.
    if (line.startsWith('+++ b/')) {
      modified.add(line.slice(6).trim());
    }
  }
  return modified;
}

/**
 * Try to read `contracts/version.ts` and extract the exported version constant.
 * Returns null if the file doesn't exist or has no parseable constant.
 */
export function readContractVersion(repo: string): string | null {
  const versionPath = join(repo, 'contracts/version.ts');
  if (!existsSync(versionPath)) return null;
  let text: string;
  try {
    text = readFileSync(versionPath, 'utf8');
  } catch {
    return null;
  }
  // Match: export const CONTRACT_VERSION = '1.2.3';
  const m = /export\s+const\s+\w+\s*=\s*['"]([^'"]+)['"]/.exec(text);
  return m ? m[1] : null;
}

/**
 * Check if `CONTRACTS.md` contains an up-to-date row for the given file
 * at the given version.
 */
export function contractsMdCoversFile(
  repo: string,
  filePath: string,
  version: string,
): boolean {
  const contractsMdPath = join(repo, 'CONTRACTS.md');
  if (!existsSync(contractsMdPath)) return false;
  let text: string;
  try {
    text = readFileSync(contractsMdPath, 'utf8');
  } catch {
    return false;
  }
  const normalizedPath = filePath.replace(/^\.\//, '');
  for (const line of text.split('\n')) {
    if (line.includes(normalizedPath) && line.includes(version)) {
      return true;
    }
  }
  return false;
}

export interface ContractViolation {
  file: string;
  reason: string;
}

/**
 * Core logic: given lists of modified contract files + version metadata,
 * compute violations.
 */
export function checkViolations(
  modifiedContractFiles: string[],
  versionTsModified: boolean,
  contractsMdModified: boolean,
  contractVersion: string | null,
  coversFile: (file: string, version: string) => boolean,
): ContractViolation[] {
  if (modifiedContractFiles.length === 0) return [];
  if (versionTsModified) return [];

  const violations: ContractViolation[] = [];
  for (const file of modifiedContractFiles) {
    if (
      contractsMdModified &&
      contractVersion &&
      coversFile(file, contractVersion)
    ) {
      continue;
    }
    violations.push({
      file,
      reason: contractsMdModified
        ? `CONTRACTS.md was modified but does not cover ${file} at version ${contractVersion ?? 'unknown'}`
        : 'contracts/version.ts was not bumped and CONTRACTS.md was not updated',
    });
  }
  return violations;
}

async function main(): Promise<number> {
  const repo = join(import.meta.dir, '..');

  const contractVersion = readContractVersion(repo);
  if (contractVersion === null) {
    process.stdout.write(
      'check:contract: contracts/version.ts not found — nothing to enforce (US-007 pending)\n',
    );
    return 0;
  }

  const contractFiles = findContractFiles(repo, defaultSpawn);
  if (contractFiles.length === 0) {
    process.stdout.write(
      'check:contract: no @contract platform-tenant-v1 files found\n',
    );
    return 0;
  }

  const allFilesToDiff = [
    ...contractFiles,
    'contracts/version.ts',
    'CONTRACTS.md',
  ];
  const diff = gitDiffFiles(repo, allFilesToDiff, defaultSpawn);
  const modified = modifiedFilesFromDiff(diff);

  const modifiedContractFiles = contractFiles
    .map((f) => f.replace(/^\.\//, ''))
    .filter((f) => modified.has(f));

  if (modifiedContractFiles.length === 0) {
    process.stdout.write(
      `check:contract: ${contractFiles.length} contract file(s) found, none modified vs origin/main\n`,
    );
    return 0;
  }

  const versionTsModified = modified.has('contracts/version.ts');
  const contractsMdModified = modified.has('CONTRACTS.md');

  const violations = checkViolations(
    modifiedContractFiles,
    versionTsModified,
    contractsMdModified,
    contractVersion,
    (file, version) => contractsMdCoversFile(repo, file, version),
  );

  if (violations.length === 0) {
    process.stdout.write(
      `check:contract: ${modifiedContractFiles.length} contract file(s) modified — version bump or CONTRACTS.md update confirmed\n`,
    );
    return 0;
  }

  process.stderr.write(`check:contract: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    process.stderr.write(`  ${v.file}: ${v.reason}\n`);
  }
  process.stderr.write(
    '  Resolution: bump contracts/version.ts OR update CONTRACTS.md to cover every modified contract file.\n',
  );
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
