/**
 * Reset script — drops and re-creates the database from scratch.
 *
 * Usage: bun run db:reset
 */
import postgres from 'postgres';

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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(`${red('✗')} DATABASE_URL is required`);
  process.exit(1);
}

console.log(dim('Resetting database...'));

// 1. Drop and recreate database
const url = new URL(databaseUrl);
const dbName = url.pathname.slice(1);
if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
  console.error(`${red('✗')} Invalid database name: ${dbName}`);
  process.exit(1);
}
url.pathname = '/postgres';

const adminSql = postgres(url.toString());
try {
  await adminSql.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
  );
  await adminSql.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await adminSql.unsafe(`CREATE DATABASE "${dbName}"`);
} finally {
  await adminSql.end();
}
console.log(`${green('✓')} Database recreated`);

// 2. Apply fixtures + push schema
console.log(dim('Pushing...'));
run(['bun', 'run', 'db:push']);
console.log(`${green('✓')} Schema pushed`);

// 3. Seed
console.log(dim('Seeding...'));
run(['bun', 'run', 'db:seed']);
console.log(`${green('✓')} Seed complete`);

console.log(green('\n✓ Reset complete. Run `bun run dev` to start.'));
