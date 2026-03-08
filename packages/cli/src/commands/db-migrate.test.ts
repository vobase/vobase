import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { runDbMigrate } from './db-migrate';

const testDir = resolve(tmpdir(), `vobase-migrate-test-${process.pid}`);

beforeAll(async () => {
  await mkdir(testDir, { recursive: true });
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('runDbMigrate', () => {
  beforeEach(async () => {
    // Clean up test directory for each test
    await rm(resolve(testDir, 'data'), { recursive: true, force: true });
  });

  it('should create backup directory if it does not exist', async () => {
    // Create a DB file so backup logic triggers
    await mkdir(resolve(testDir, 'data'), { recursive: true });
    const dbPath = resolve(testDir, 'data/vobase.db');
    await writeFile(dbPath, 'test db content');

    // Mock Bun.spawn to avoid needing drizzle-kit
    const originalSpawn = Bun.spawn;
    const spawnCalls: Array<{ args: string[]; cwd: string }> = [];

    // @ts-expect-error - patching for test
    // biome-ignore lint/suspicious/noExplicitAny: mocking for tests
    Bun.spawn = (args: string[], options: any) => {
      spawnCalls.push({ args, cwd: options.cwd });
      return {
        exited: Promise.resolve(0),
        stdout: 'inherit',
        stderr: 'inherit',
      };
    };

    try {
      await runDbMigrate({ cwd: testDir });

      const backupDirPath = resolve(testDir, 'data/backups');
      const backupDirExists = existsSync(backupDirPath);
      expect(backupDirExists).toBe(true);
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0]?.args).toEqual(['bunx', 'drizzle-kit', 'migrate']);
    } finally {
      Bun.spawn = originalSpawn as typeof Bun.spawn;
    }
  });

  it('should backup existing DB with ISO timestamp format', async () => {
    // Create test DB file
    await mkdir(resolve(testDir, 'data'), { recursive: true });
    const dbPath = resolve(testDir, 'data/vobase.db');
    await writeFile(dbPath, 'test db content');

    const originalSpawn = Bun.spawn;
    // @ts-expect-error - patching for test
    // biome-ignore lint/suspicious/noExplicitAny: mocking for tests
    Bun.spawn = (_args: string[], _options: any) => {
      return {
        exited: Promise.resolve(0),
        stdout: 'inherit',
        stderr: 'inherit',
      };
    };

    try {
      await runDbMigrate({ cwd: testDir });

      // Check that backup was created
      const backupDirPath = resolve(testDir, 'data/backups');
      const backupDirExists = existsSync(backupDirPath);
      expect(backupDirExists).toBe(true);

      // Verify backup file exists and has correct naming format
      const backupFiles = await readdir(backupDirPath);
      expect(backupFiles.length).toBeGreaterThan(0);

      // Check filename format: vobase-YYYY-MM-DDTHH-mm-ss.db
      const backupFile = backupFiles[0];
      expect(backupFile).toMatch(
        /^vobase-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/,
      );
    } finally {
      Bun.spawn = originalSpawn as typeof Bun.spawn;
    }
  });

  it('should copy DB file to backup with byte-identical content', async () => {
    // Create test DB file with specific content
    await mkdir(resolve(testDir, 'data'), { recursive: true });
    const dbPath = resolve(testDir, 'data/vobase.db');
    const originalContent = 'test database content 12345';
    await writeFile(dbPath, originalContent);

    const originalSpawn = Bun.spawn;
    // @ts-expect-error - patching for test
    // biome-ignore lint/suspicious/noExplicitAny: mocking for tests
    Bun.spawn = (_args: string[], _options: any) => {
      return {
        exited: Promise.resolve(0),
        stdout: 'inherit',
        stderr: 'inherit',
      };
    };

    try {
      await runDbMigrate({ cwd: testDir });

      // Get backup file
      const backupDirPath = resolve(testDir, 'data/backups');
      const backupFiles = await readdir(backupDirPath);
      const backupFile = backupFiles[0];
      const backupPath = resolve(backupDirPath, backupFile);

      // Verify byte-identical content
      const backupContent = await Bun.file(backupPath).text();
      expect(backupContent).toBe(originalContent);
    } finally {
      Bun.spawn = originalSpawn as typeof Bun.spawn;
    }
  });

  it('should not attempt backup if DB does not exist', async () => {
    const originalSpawn = Bun.spawn;
    const spawnCalls: Array<{ args: string[]; cwd: string }> = [];

    // @ts-expect-error - patching for test
    // biome-ignore lint/suspicious/noExplicitAny: mocking for tests
    Bun.spawn = (args: string[], options: any) => {
      spawnCalls.push({ args, cwd: options.cwd });
      return {
        exited: Promise.resolve(0),
        stdout: 'inherit',
        stderr: 'inherit',
      };
    };

    try {
      await runDbMigrate({ cwd: testDir });

      // Verify drizzle-kit was called
      expect(spawnCalls.length).toBe(1);

      // Backup directory might exist but should be empty
      const backupDirPath = resolve(testDir, 'data/backups');
      if (existsSync(backupDirPath)) {
        const files = await readdir(backupDirPath);
        expect(files.length).toBe(0);
      }
    } finally {
      Bun.spawn = originalSpawn as typeof Bun.spawn;
    }
  });

  it('should throw error if drizzle-kit exits with non-zero code', async () => {
    const originalSpawn = Bun.spawn;

    // @ts-expect-error - patching for test
    // biome-ignore lint/suspicious/noExplicitAny: mocking for tests
    Bun.spawn = (_args: string[], _options: any) => {
      return {
        exited: Promise.resolve(1),
        stdout: 'inherit',
        stderr: 'inherit',
      };
    };

    try {
      await expect(runDbMigrate({ cwd: testDir })).rejects.toThrow(
        'drizzle-kit migrate exited with code 1',
      );
    } finally {
      Bun.spawn = originalSpawn as typeof Bun.spawn;
    }
  });

  it('should use default DB path when vobase.config.ts does not exist', async () => {
    const originalSpawn = Bun.spawn;
    const spawnCalls: Array<{ args: string[]; cwd: string }> = [];

    // @ts-expect-error - patching for test
    // biome-ignore lint/suspicious/noExplicitAny: mocking for tests
    Bun.spawn = (args: string[], options: any) => {
      spawnCalls.push({ args, cwd: options.cwd });
      return {
        exited: Promise.resolve(0),
        stdout: 'inherit',
        stderr: 'inherit',
      };
    };

    try {
      // Don't create vobase.config.ts - should fall back to default
      await runDbMigrate({ cwd: testDir });

      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0]?.cwd).toBe(testDir);
    } finally {
      Bun.spawn = originalSpawn as typeof Bun.spawn;
    }
  });
});
