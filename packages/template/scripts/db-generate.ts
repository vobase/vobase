/**
 * Generate a Drizzle migration from schema diff, then prepend current.sql
 * fixtures into the migration file and reset current.sql to the template.
 *
 * Usage: bun run db:generate [migration-name]
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { processSqlFile } from './utils/process-sql-file';

const name = process.argv[2] || `migration_${Date.now()}`;
const drizzleDir = join(import.meta.dir, '..', 'drizzle');

// Snapshot existing migration folders before generating
const before = new Set(readdirSync(drizzleDir));

// 1. Run drizzle-kit generate with full TTY passthrough (stdio: inherit)
const proc = Bun.spawnSync(['bunx', 'drizzle-kit', 'generate', '--name', name], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  cwd: join(import.meta.dir, '..'),
});

if (proc.exitCode !== 0) {
  process.exit(proc.exitCode);
}

// 2. Find the newly created migration folder
const after = readdirSync(drizzleDir);
const newFolder = after.find((f) => !before.has(f) && !f.startsWith('.'));

if (!newFolder) {
  console.error('[db:generate] No new migration folder found — schema may already be in sync');
  process.exit(0);
}

const migrationPath = join(drizzleDir, newFolder, 'migration.sql');

// 3. Prepend fixtures into the migration (fixtures must run before schema)
const currentSqlPath = join(import.meta.dir, '..', 'db', 'current.sql');
const currentSql = await processSqlFile(currentSqlPath);
const schemaSql = await Bun.file(migrationPath).text();

await Bun.write(migrationPath, `${currentSql}\n${schemaSql}`);
console.log(`[db:generate] Fixtures baked into ${migrationPath}`);

// 4. Reset current.sql to template
const resetTemplate = `-- Fixtures entry point
-- Use --!include to include SQL files with glob support
-- Run \`bun run db:push\` to apply during development
-- Run \`bun run db:generate\` to bake into a migration
`;

await Bun.write(currentSqlPath, resetTemplate);
console.log('[db:generate] current.sql reset to template');
