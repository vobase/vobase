/**
 * Generate a Drizzle migration from schema diff, then prepend current.sql
 * fixtures into the migration file and reset current.sql to the template.
 *
 * Usage: bun run db:generate
 */
import { $ } from 'bun';

import { processSqlFile } from './utils/process-sql-file';

// 1. Run drizzle-kit generate for schema changes
const output = await $`bun run drizzle-kit generate`.text();
console.log(output.trim());

// Extract migration.sql path — format: drizzle/TIMESTAMP_name/migration.sql
const migrationMatch = output.match(/drizzle\/\S+\/migration\.sql/);

if (!migrationMatch) {
  console.error('[db:generate] No migration file found in drizzle-kit output');
  console.error(output);
  process.exit(1);
}

const migrationPath = migrationMatch[0];

// 2. Prepend fixtures into the migration (fixtures must run before schema)
const currentSqlPath = `${import.meta.dir}/../db/current.sql`;
const currentSql = await processSqlFile(currentSqlPath);
const schemaSql = await Bun.file(migrationPath).text();

await Bun.write(migrationPath, `${currentSql}\n${schemaSql}`);
console.log(`[db:generate] Fixtures baked into ${migrationPath}`);

// 3. Reset current.sql to template
const resetTemplate = `-- Fixtures entry point
-- Use --!include to include SQL files with glob support
-- Run \`bun run db:push\` to apply during development
-- Run \`bun run db:generate\` to bake into a migration

-- Extensions
--!include extensions/*.sql

-- Functions
--!include fixtures/functions/*.sql

-- Triggers
--!include fixtures/triggers/*.sql
`;

await Bun.write(currentSqlPath, resetTemplate);
console.log('[db:generate] current.sql reset to template');
