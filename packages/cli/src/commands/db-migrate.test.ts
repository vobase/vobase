import { Database } from 'bun:sqlite';
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

/** Create a valid SQLite database file at the given path. */
function createTestDb(dbPath: string): void {
  const db = new Database(dbPath, { create: true });
  db.run('CREATE TABLE _test (id INTEGER PRIMARY KEY)');
  db.close();
}

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
    // Create a valid SQLite DB so backup logic triggers
    await mkdir(resolve(testDir, 'data'), { recursive: true });
    const dbPath = resolve(testDir, 'data/vobase.db');
    createTestDb(dbPath);

    // Create an empty drizzle folder with one migration
    const drizzleDir = resolve(testDir, 'drizzle');
    await mkdir(drizzleDir, { recursive: true });
    await writeFile(resolve(drizzleDir, '0000_init.sql'), 'SELECT 1;');

    try {
      await runDbMigrate({ cwd: testDir });

      const backupDirPath = resolve(testDir, 'data/backups');
      const backupDirExists = existsSync(backupDirPath);
      expect(backupDirExists).toBe(true);
    } finally {
      // cleanup drizzle dir
      await rm(resolve(testDir, 'drizzle'), { recursive: true, force: true });
    }
  });

  it('should backup existing DB with ISO timestamp format', async () => {
    // Create a valid SQLite DB
    await mkdir(resolve(testDir, 'data'), { recursive: true });
    const dbPath = resolve(testDir, 'data/vobase.db');
    createTestDb(dbPath);

    // Create drizzle folder with one migration
    const drizzleDir = resolve(testDir, 'drizzle');
    await mkdir(drizzleDir, { recursive: true });
    await writeFile(resolve(drizzleDir, '0000_init.sql'), 'SELECT 1;');

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
      await rm(resolve(testDir, 'drizzle'), { recursive: true, force: true });
    }
  });

  it('should copy DB file to backup with byte-identical content', async () => {
    // Create a valid SQLite DB with specific content
    await mkdir(resolve(testDir, 'data'), { recursive: true });
    const dbPath = resolve(testDir, 'data/vobase.db');
    createTestDb(dbPath);
    const originalBytes = await Bun.file(dbPath).arrayBuffer();

    // Create drizzle folder with one migration
    const drizzleDir = resolve(testDir, 'drizzle');
    await mkdir(drizzleDir, { recursive: true });
    await writeFile(resolve(drizzleDir, '0000_init.sql'), 'SELECT 1;');

    try {
      await runDbMigrate({ cwd: testDir });

      // Get backup file
      const backupDirPath = resolve(testDir, 'data/backups');
      const backupFiles = await readdir(backupDirPath);
      const backupFile = backupFiles[0]!;
      const backupPath = resolve(backupDirPath, backupFile);

      // Verify byte-identical content
      const backupBytes = await Bun.file(backupPath).arrayBuffer();
      expect(new Uint8Array(backupBytes)).toEqual(new Uint8Array(originalBytes));
    } finally {
      await rm(resolve(testDir, 'drizzle'), { recursive: true, force: true });
    }
  });

  it('should not attempt backup if DB does not exist', async () => {
    // Create drizzle folder with one migration (but no existing DB)
    const drizzleDir = resolve(testDir, 'drizzle');
    await mkdir(drizzleDir, { recursive: true });
    await writeFile(resolve(drizzleDir, '0000_init.sql'), 'SELECT 1;');

    try {
      await runDbMigrate({ cwd: testDir });

      // Backup directory should not exist or be empty (no DB to backup)
      const backupDirPath = resolve(testDir, 'data/backups');
      if (existsSync(backupDirPath)) {
        const files = await readdir(backupDirPath);
        expect(files.length).toBe(0);
      }

      // DB should have been created
      const defaultDbPath = resolve(testDir, 'data/vobase.db');
      expect(existsSync(defaultDbPath)).toBe(true);
    } finally {
      await rm(resolve(testDir, 'drizzle'), { recursive: true, force: true });
    }
  });

  it('should throw error if migrations folder does not exist', async () => {
    // No drizzle folder — should throw about missing migrations
    await expect(runDbMigrate({ cwd: testDir })).rejects.toThrow(
      'Migrations folder not found',
    );
  });

  it('should use default DB path when vobase.config.ts does not exist', async () => {
    // Create drizzle folder with one migration
    const drizzleDir = resolve(testDir, 'drizzle');
    await mkdir(drizzleDir, { recursive: true });
    await writeFile(resolve(drizzleDir, '0000_init.sql'), 'SELECT 1;');

    try {
      // Don't create vobase.config.ts - should fall back to default ./data/vobase.db
      await runDbMigrate({ cwd: testDir });

      // DB should be created at default path
      const defaultDbPath = resolve(testDir, 'data/vobase.db');
      expect(existsSync(defaultDbPath)).toBe(true);
    } finally {
      await rm(resolve(testDir, 'drizzle'), { recursive: true, force: true });
    }
  });
});
