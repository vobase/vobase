#!/usr/bin/env node
import { downloadTemplate } from 'giget';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const name = process.argv[2];

if (!name) {
  console.error('Usage: create-vobase <project-name>');
  process.exit(1);
}

const dest = resolve(process.cwd(), name);

console.log(`Creating vobase project in ${dest}...`);

await downloadTemplate('github:vobase/vobase/packages/template', {
  dir: dest,
  force: false,
});

console.log('Installing dependencies...');
execSync('bun install', { cwd: dest, stdio: 'inherit' });

console.log(`
Done! Your vobase project is ready.

  cd ${name}
  bun run dev
`);
