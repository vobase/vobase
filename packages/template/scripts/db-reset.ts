/**
 * Reset script — deletes the database and re-creates it from scratch.
 *
 * Usage: bun run db:reset
 */
import { $ } from 'bun';

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

console.log(dim('Resetting database...'));

// 1. Nuke data
await $`rm -rf ./data/pgdata && mkdir -p ./data`;
console.log(`${green('✓')} Cleaned data/`);

// 2. Apply fixtures + push schema (merged in db:push)
console.log(dim('Pushing...'));
run(['bun', 'run', 'db:push']);
console.log(`${green('✓')} Schema pushed`);

// 3. Seed
console.log(dim('Seeding...'));
run(['bun', 'run', 'db:seed']);
console.log(`${green('✓')} Seed complete`);

console.log(green('\n✓ Reset complete. Run `bun run dev` to start.'));
