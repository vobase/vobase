import { afterAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { HELP_TEXT } from '../bin';
import { runInit } from './init';

const createdPaths: string[] = [];

function rememberPath(pathValue: string): string {
  createdPaths.push(pathValue);
  return pathValue;
}

async function createTempRoot(): Promise<string> {
  return rememberPath(await mkdtemp(join(tmpdir(), 'vobase-init-test-')));
}

function withMockedSpawn(
  handler: (calls: Array<{ command: string[]; cwd?: string }>) => Promise<void>,
): Promise<void> {
  const calls: Array<{ command: string[]; cwd?: string }> = [];
  const mutableBun = Bun as unknown as { spawn: typeof Bun.spawn };
  const originalSpawn = mutableBun.spawn;

  mutableBun.spawn = ((...args: Parameters<typeof Bun.spawn>) => {
    const command = args[0] as string[];
    const options = (args[1] ?? {}) as { cwd?: string };
    calls.push({ command, cwd: options.cwd });

    return {
      exited: Promise.resolve(0),
      stdout: null,
      stderr: null,
      stdin: null,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as typeof Bun.spawn;

  return handler(calls).finally(() => {
    mutableBun.spawn = originalSpawn;
  });
}

describe('runInit', () => {
  afterAll(async () => {
    for (const pathValue of createdPaths) {
      await rm(pathValue, { recursive: true, force: true });
    }
  });

  it('creates the project scaffold with all expected template files', async () => {
    const tempRoot = await createTempRoot();
    const targetDir = resolve(tempRoot, 'acme-app');

    await withMockedSpawn(async (calls) => {
      await runInit('acme-app', { targetDir });

      const expectedFiles = [
        'package.json',
        'server.ts',
        'vobase.config.ts',
        'vite.config.ts',
        'tsconfig.json',
        'drizzle.config.ts',
        '.gitignore',
        '.env.example',
        'modules/index.ts',
      ];

      for (const relativePath of expectedFiles) {
        expect(await Bun.file(join(targetDir, relativePath)).exists()).toBe(true);
      }

      expect(calls).toEqual([
        { command: ['bun', 'install'], cwd: targetDir },
        { command: ['bunx', 'vobase', 'generate'], cwd: targetDir },
      ]);
    });
  });

  it('replaces package name token with project name', async () => {
    const tempRoot = await createTempRoot();
    const targetDir = resolve(tempRoot, 'billing-api');

    await withMockedSpawn(async () => {
      await runInit('billing-api', { targetDir });
    });

    const packageJson = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
      name: string;
    };

    expect(packageJson.name).toBe('billing-api');
  });

  it('throws when target directory already exists', async () => {
    const tempRoot = await createTempRoot();
    const targetDir = resolve(tempRoot, 'existing-app');
    await mkdir(targetDir, { recursive: true });

    await withMockedSpawn(async (calls) => {
      await expect(runInit('existing-app', { targetDir })).rejects.toThrow(
        `Target directory already exists: ${targetDir}`,
      );
      expect(calls).toHaveLength(0);
    });
  });
});

describe('cli help text', () => {
  it('lists all available commands', () => {
    expect(HELP_TEXT).toContain('generate');
    expect(HELP_TEXT).toContain('migrate');
    expect(HELP_TEXT).toContain('migrate:generate');
    expect(HELP_TEXT).toContain('dev');
    expect(HELP_TEXT).toContain('init <name>');
  });
});
