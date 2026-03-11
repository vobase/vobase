#!/usr/bin/env bun
import { $ } from 'bun';
import { downloadTemplate } from 'giget';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const name = process.argv[2];

if (!name) {
  console.error('Usage: bun create vobase <project-name>');
  process.exit(1);
}

const dest = resolve(process.cwd(), name);
const projectName = basename(dest);

console.log(`Creating vobase project in ${dest}...`);

await downloadTemplate('github:vobase/vobase/packages/template', {
  dir: dest,
  force: false,
});

// --- Post-process package.json ---
const pkgPath = resolve(dest, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

pkg.name = projectName;
delete pkg.private;

// Replace workspace:* dependencies with latest published versions
for (const depField of ['dependencies', 'devDependencies']) {
  const deps = pkg[depField];
  if (!deps) continue;
  for (const [dep, version] of Object.entries(deps)) {
    if (typeof version === 'string' && version.startsWith('workspace:')) {
      const latest = (await $`npm view ${dep} version`.text()).trim();
      deps[dep] = `^${latest}`;
      console.log(`  ${dep}: workspace:* → ^${latest}`);
    }
  }
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// --- Copy .env.example → .env with a real secret ---
const envExample = resolve(dest, '.env.example');
const envFile = resolve(dest, '.env');
if (existsSync(envExample) && !existsSync(envFile)) {
  let env = readFileSync(envExample, 'utf8');
  const secret = randomBytes(32).toString('base64url');
  env = env.replace(/AUTH_SECRET=.*/, `AUTH_SECRET=${secret}`);
  writeFileSync(envFile, env);
}

// --- Create data directory ---
mkdirSync(resolve(dest, 'data'), { recursive: true });

// --- Install dependencies ---
console.log('Installing dependencies...');
await $`bun install`.cwd(dest);

// --- Generate routes ---
console.log('Generating routes...');
await $`bun run scripts/generate.ts`.cwd(dest);

// --- Push schema to SQLite ---
console.log('Setting up database...');
await $`bun run db:push`.cwd(dest);

console.log(`
Done! Your vobase project is ready.

  cd ${name}
  bun run dev
`);
