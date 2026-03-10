import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Database } from 'bun:sqlite';

/**
 * Read the drizzle config to get the migrations output folder.
 * Falls back to './drizzle' if not found.
 */
async function getMigrationsFolder(cwd: string): Promise<string> {
  try {
    const configPath = resolve(cwd, 'drizzle.config.ts');
    const config = await import(configPath);
    return config?.default?.out ?? './drizzle';
  } catch {
    return './drizzle';
  }
}

interface MigrationFile {
  name: string;
  sql: string;
}

/**
 * Read migration SQL files from the migrations folder.
 * Supports two formats:
 *   - New: {folder}/{name}/migration.sql (subdirectories)
 *   - Legacy: {folder}/{name}.sql (flat files)
 */
function readMigrations(migrationsFolder: string): MigrationFile[] {
  if (!existsSync(migrationsFolder)) {
    throw new Error(`Migrations folder not found: ${migrationsFolder}`);
  }

  const entries = readdirSync(migrationsFolder, { withFileTypes: true });
  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    if (entry.name === 'meta' || entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      const sqlPath = join(migrationsFolder, entry.name, 'migration.sql');
      if (existsSync(sqlPath)) {
        migrations.push({
          name: entry.name,
          sql: readFileSync(sqlPath, 'utf-8'),
        });
      }
    } else if (entry.name.endsWith('.sql')) {
      migrations.push({
        name: entry.name.replace(/\.sql$/, ''),
        sql: readFileSync(join(migrationsFolder, entry.name), 'utf-8'),
      });
    }
  }

  migrations.sort((a, b) => a.name.localeCompare(b.name));
  return migrations;
}

export async function runDbMigrate(
  options: { cwd?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Step 1: Read DB path from vobase.config.ts, default to ./data/vobase.db
  let dbPath = './data/vobase.db';
  try {
    const configPath = resolve(cwd, 'vobase.config.ts');
    const config = await import(configPath).catch(() => null);
    if (config?.default?.database) {
      dbPath = config.default.database;
    }
  } catch {
    // Silently fall back to default
  }

  // Resolve to absolute path
  const absoluteDbPath = resolve(cwd, dbPath);

  // Step 2 & 3: Create backup if DB exists
  const dbExists = await Bun.file(absoluteDbPath).exists();
  if (dbExists) {
    const backupDir = resolve(cwd, 'data/backups');
    await mkdir(backupDir, { recursive: true });

    const now = new Date();
    const isoTimestamp =
      now.toISOString().split('.')[0]?.replace(/:/g, '-') ?? '';
    const backupPath = resolve(backupDir, `vobase-${isoTimestamp}.db`);

    const dbFile = Bun.file(absoluteDbPath);
    const backupFile = Bun.file(backupPath);
    await Bun.write(backupFile, dbFile);

    console.log(`Backup created: ${backupPath}`);
  }

  // Step 4: Run migrations
  const migrationsFolder = resolve(cwd, await getMigrationsFolder(cwd));

  console.log(`Database: ${absoluteDbPath}`);
  console.log(`Migrations: ${migrationsFolder}`);

  const sqlite = new Database(absoluteDbPath, { create: true });

  try {
    sqlite.run('PRAGMA journal_mode = WAL');
    sqlite.run('PRAGMA busy_timeout = 5000');
    sqlite.run('PRAGMA synchronous = NORMAL');
    sqlite.run('PRAGMA foreign_keys = ON');
    sqlite.run('PRAGMA temp_store = MEMORY');
    sqlite.run('PRAGMA cache_size = -64000');
    sqlite.run('PRAGMA journal_size_limit = 67108864');
    sqlite.run('PRAGMA mmap_size = 134217728');

    // Ensure migrations tracking table exists
    sqlite.run(`
      CREATE TABLE IF NOT EXISTS __vobase_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )
    `);

    const applied = new Set(
      sqlite
        .query('SELECT name FROM __vobase_migrations')
        .all()
        .map((row) => (row as { name: string }).name),
    );

    const migrations = readMigrations(migrationsFolder);
    let count = 0;

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;

      console.log(`  Applying: ${migration.name}`);

      const statements = migration.sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      sqlite.run('BEGIN');
      try {
        for (const stmt of statements) {
          sqlite.run(stmt);
        }
        sqlite.run(
          'INSERT INTO __vobase_migrations (name) VALUES (?)',
          [migration.name],
        );
        sqlite.run('COMMIT');
        count++;
      } catch (err) {
        sqlite.run('ROLLBACK');
        throw err;
      }
    }

    if (count === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Applied ${count} migration${count > 1 ? 's' : ''}.`);
    }

    console.log('Migrations applied successfully.');
  } finally {
    sqlite.close();
  }
}
