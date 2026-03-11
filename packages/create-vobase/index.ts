#!/usr/bin/env node
import { downloadTemplate } from 'giget';
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

// Replace workspace:* dependencies with latest published versions
const pkgPath = resolve(dest, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

pkg.name = name;
delete pkg.private;

for (const depField of ['dependencies', 'devDependencies']) {
  const deps = pkg[depField];
  if (!deps) continue;
  for (const [dep, version] of Object.entries(deps)) {
    if (typeof version === 'string' && version.startsWith('workspace:')) {
      const latest = execFileSync('npm', ['view', dep, 'version'], {
        encoding: 'utf8',
      }).trim();
      deps[dep] = `^${latest}`;
      console.log(`  ${dep}: workspace:* → ^${latest}`);
    }
  }
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log('Installing dependencies...');
execSync('bun install', { cwd: dest, stdio: 'inherit' });

console.log(`
Done! Your vobase project is ready.

  cd ${name}
  bun run dev
`);
