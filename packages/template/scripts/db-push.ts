/**
 * Apply current.sql fixtures to the database, then push the Drizzle schema.
 *
 * Fixtures (extensions, functions, triggers) must run before schema push
 * because the schema depends on them (e.g. nanoid for default column values).
 *
 * Usage: bun run db:push
 */
import postgres from 'postgres';

import { processSqlFile } from './utils/process-sql-file';

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function run(cmd: string[]) {
  const result = Bun.spawnSync(cmd, {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (result.exitCode !== 0) {
    console.error(`${red('✗')} Command failed: ${cmd.join(' ')}`);
    process.exit(1);
  }
}

// 1. Apply fixtures
const currentSqlPath = `${import.meta.dir}/../db/current.sql`;
const currentSql = await processSqlFile(currentSqlPath);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(`${red('✗')} DATABASE_URL is required`);
  process.exit(1);
}

console.log(dim('Applying fixtures...'));
const sql = postgres(databaseUrl);
try {
  await sql.unsafe(currentSql);
} finally {
  await sql.end();
}
console.log(`${green('✓')} Fixtures applied`);

// 2. Push schema
console.log(dim('Pushing schema...'));
run(['bun', 'run', 'drizzle-kit', 'push']);
console.log(`${green('✓')} Schema pushed`);
