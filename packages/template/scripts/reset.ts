/**
 * Reset script — deletes the database and re-creates it from scratch.
 *
 * Usage: bun run reset
 */
import { rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(red('✗') + ` Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

console.log(dim('Resetting database...'));

// 1. Delete data directory
try {
  rmSync('./data', { recursive: true, force: true });
  console.log(green('✓') + ' Deleted data/');
} catch {
  console.log(dim('  data/ did not exist, skipping'));
}

// 2. Re-create data directory
mkdirSync('./data', { recursive: true });
console.log(green('✓') + ' Created data/');

// 3. Push schema
console.log(dim('Pushing schema...'));
run('bun', ['run', 'db:push']);
console.log(green('✓') + ' Schema pushed');

// 4. Seed
console.log(dim('Seeding...'));
run('bun', ['run', 'seed']);
console.log(green('✓') + ' Seed complete');

console.log(green('\n✓ Reset complete. Run `bun run dev` to start.'));
