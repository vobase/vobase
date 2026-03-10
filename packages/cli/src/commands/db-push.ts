import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Database } from 'bun:sqlite';
import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Glob } from 'bun';

/**
 * Read the DB path from vobase.config.ts, falling back to ./data/vobase.db.
 */
async function getDbPath(cwd: string): Promise<string> {
  try {
    const configPath = resolve(cwd, 'vobase.config.ts');
    const config = await import(configPath);
    return config?.default?.database ?? './data/vobase.db';
  } catch {
    return './data/vobase.db';
  }
}

/**
 * Read the schema glob from drizzle.config.ts.
 */
async function getSchemaGlob(cwd: string): Promise<string> {
  try {
    const configPath = resolve(cwd, 'drizzle.config.ts');
    const config = await import(configPath);
    return config?.default?.schema ?? './modules/*/schema.ts';
  } catch {
    return './modules/*/schema.ts';
  }
}

/**
 * Apply recommended SQLite PRAGMAs.
 */
function applyPragmas(db: Database): void {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA temp_store = MEMORY');
  db.run('PRAGMA cache_size = -64000');
  db.run('PRAGMA journal_size_limit = 67108864');
  db.run('PRAGMA mmap_size = 134217728');
}

/**
 * Generate a quoted SQL default value.
 */
function formatDefault(value: unknown): string {
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Generate a column definition SQL fragment.
 */
function columnToSql(col: AnySQLiteColumn): string {
  const parts: string[] = [`\`${col.name}\``, col.getSQLType()];

  if (col.primary) parts.push('PRIMARY KEY');
  if (col.notNull) parts.push('NOT NULL');
  if (col.isUnique) parts.push('UNIQUE');

  // Static default (not $defaultFn which is JS-only)
  if (col.hasDefault && col.default !== undefined && !col.defaultFn) {
    parts.push(`DEFAULT ${formatDefault(col.default)}`);
  }

  return parts.join(' ');
}

interface ExistingColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

/**
 * Push schema changes directly to the database.
 *
 * Reads drizzle schema TypeScript files, compares against the current DB state,
 * and applies CREATE TABLE / ALTER TABLE ADD COLUMN as needed.
 *
 * This bypasses drizzle-kit (which spawns a Node.js subprocess that cannot
 * resolve bun:sqlite) by doing the schema introspection natively under bun.
 */
export async function runDbPush(
  options: { cwd?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const dbPath = resolve(cwd, await getDbPath(cwd));
  const schemaGlob = await getSchemaGlob(cwd);

  console.log(`Database: ${dbPath}`);
  console.log(`Schema: ${schemaGlob}`);

  // Collect all SQLiteTable exports from schema files
  const glob = new Glob(schemaGlob);
  const schemaFiles: string[] = [];
  for await (const path of glob.scan({ cwd, absolute: true })) {
    schemaFiles.push(path);
  }

  if (schemaFiles.length === 0) {
    console.log('No schema files found.');
    return;
  }

  const tables: Array<{ name: string; columns: AnySQLiteColumn[] }> = [];

  for (const filePath of schemaFiles) {
    const mod = await import(filePath);
    for (const value of Object.values(mod)) {
      if (is(value, SQLiteTable)) {
        const config = getTableConfig(value as SQLiteTable);
        tables.push({ name: config.name, columns: config.columns });
      }
    }
  }

  console.log(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''} in ${schemaFiles.length} schema file${schemaFiles.length !== 1 ? 's' : ''}.`);

  // Open database and push
  const sqlite = new Database(dbPath, { create: true });

  try {
    applyPragmas(sqlite);

    let created = 0;
    let altered = 0;

    for (const table of tables) {
      // Check if table exists
      const existing = sqlite
        .query<ExistingColumn, []>(
          `PRAGMA table_info(\`${table.name}\`)`,
        )
        .all();

      if (existing.length === 0) {
        // Create table
        const colDefs = table.columns.map(columnToSql).join(',\n  ');
        const sql = `CREATE TABLE \`${table.name}\` (\n  ${colDefs}\n)`;
        sqlite.run(sql);
        console.log(`  Created: ${table.name}`);
        created++;
      } else {
        // Check for missing columns
        const existingNames = new Set(existing.map((c) => c.name));

        for (const col of table.columns) {
          if (!existingNames.has(col.name)) {
            const colSql = columnToSql(col);
            sqlite.run(
              `ALTER TABLE \`${table.name}\` ADD COLUMN ${colSql}`,
            );
            console.log(`  Added column: ${table.name}.${col.name}`);
            altered++;
          }
        }
      }
    }

    if (created === 0 && altered === 0) {
      console.log('Schema is up to date.');
    } else {
      if (created > 0)
        console.log(`Created ${created} table${created !== 1 ? 's' : ''}.`);
      if (altered > 0)
        console.log(
          `Added ${altered} column${altered !== 1 ? 's' : ''}.`,
        );
    }
  } finally {
    sqlite.close();
  }
}
