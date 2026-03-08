import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

import { HELP_TEXT } from '../bin';

const createdPaths: string[] = [];

function rememberPath(pathValue: string): string {
  createdPaths.push(pathValue);
  return pathValue;
}

async function createTempRoot(): Promise<string> {
  return rememberPath(await mkdtemp(join(tmpdir(), 'vobase-init-test-')));
}

// Create a fake template directory to use in tests
let fakeTemplateDir: string;

beforeAll(async () => {
  fakeTemplateDir = await mkdtemp(join(tmpdir(), 'vobase-template-'));
  createdPaths.push(fakeTemplateDir);

  // Create minimal template files
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: '@vobase/template',
      dependencies: {
        '@vobase/core': 'workspace:*',
        '@vobase/cli': 'workspace:*',
      },
    }),
    'server.ts': 'console.log("{{PROJECT_NAME}}")',
    'vobase.config.ts': 'export default {}',
    'vite.config.ts': 'export default {}',
    'tsconfig.json': '{}',
    'drizzle.config.ts': 'export default {}',
    '.gitignore': 'node_modules',
    '.env.example': 'DB_PATH=data/app.db',
    'AGENTS.md': '# Agents',
    'index.html': '<html></html>',
  };

  await mkdir(join(fakeTemplateDir, 'modules'), { recursive: true });
  await writeFile(join(fakeTemplateDir, 'modules', 'index.ts'), 'export {}');

  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(fakeTemplateDir, name), content);
  }
});

// Mock giget to copy from the fake template directory instead of fetching from GitHub
mock.module('giget', () => ({
  downloadTemplate: async (_source: string, opts: { dir: string; force?: boolean }) => {
    const { cp } = await import('node:fs/promises');
    await cp(fakeTemplateDir, opts.dir, { recursive: true });
    return { dir: opts.dir };
  },
}));

// Import after mock setup
const { runInit } = await import('./init');

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
        'AGENTS.md',
      ];

      for (const relativePath of expectedFiles) {
        expect(await Bun.file(join(targetDir, relativePath)).exists()).toBe(
          true,
        );
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

    const packageJson = JSON.parse(
      await readFile(join(targetDir, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies: Record<string, string>;
    };

    expect(packageJson.name).toBe('billing-api');
    expect(packageJson.dependencies['@vobase/core']).not.toBe('workspace:*');
    expect(packageJson.dependencies['@vobase/cli']).not.toBe('workspace:*');
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
