#!/usr/bin/env bun
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { $ } from 'bun';
import { downloadTemplate } from 'giget';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const args = process.argv.slice(2);
const templateMode = args.includes('--template');
const name = args.find((a) => !a.startsWith('--'));

if (!name) {
  console.error('Usage: bun create vobase <project-name> [--template]');
  process.exit(1);
}

const isCurrent = name === '.';
const dest = resolve(process.cwd(), name);
const projectName = basename(dest);

// --template: resolve monorepo root from this script's location
const monorepoRoot = templateMode
  ? resolve(dirname(import.meta.path), '..', '..')
  : null;

// When scaffolding into the current directory, require a clean git working tree
if (isCurrent) {
  try {
    const status = (await $`git status --porcelain`.cwd(dest).text()).trim();
    if (status) {
      console.error(
        'Error: Current directory has uncommitted changes. Commit or stash them first.',
      );
      process.exit(1);
    }
  } catch {
    // Not a git repo — that's fine, proceed without the check
  }
}

console.log(`\n${bold('Creating vobase project')} in ${cyan(dest)}\n`);

if (monorepoRoot) {
  // Copy from local monorepo source
  cpSync(resolve(monorepoRoot, 'packages/template'), dest, { recursive: true });
  console.log(`${green('✓')} Copied template from monorepo`);
} else {
  await downloadTemplate('github:vobase/vobase/packages/template', {
    dir: dest,
    force: isCurrent,
  });
  console.log(`${green('✓')} Downloaded template`);
}

// --- Agent skills ---
const claudeSkillsDir = resolve(dest, '.claude', 'skills');
if (monorepoRoot) {
  const srcSkills = resolve(monorepoRoot, '.claude/skills');
  if (existsSync(srcSkills)) {
    cpSync(srcSkills, claudeSkillsDir, { recursive: true });
  }
} else {
  await downloadTemplate('github:vobase/vobase/.claude/skills', {
    dir: claudeSkillsDir,
    force: true,
  });
}
console.log(
  `${green('✓')} ${monorepoRoot ? 'Copied' : 'Downloaded'} agent skills`,
);

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
      console.log(dim(`  ${dep}: workspace:* → ^${latest}`));
    }
  }
}

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`${green('✓')} Resolved dependencies`);

// --- Copy .biome/plugins/ so the standalone biome.json can reference them ---
{
  const pluginsSrc = monorepoRoot
    ? resolve(monorepoRoot, '.biome/plugins')
    : null;
  if (pluginsSrc && existsSync(pluginsSrc)) {
    cpSync(pluginsSrc, resolve(dest, '.biome/plugins'), { recursive: true });
  } else if (!monorepoRoot) {
    await downloadTemplate('github:vobase/vobase/.biome/plugins', {
      dir: resolve(dest, '.biome/plugins'),
      force: true,
    });
  }
  console.log(`${green('✓')} ${monorepoRoot ? 'Copied' : 'Downloaded'} biome plugins`);
}

// --- Generate biome.json (standalone, derived from root biome.jsonc) ---
const biomePath = resolve(dest, 'biome.json');
{
  // The scaffolded project has no root/monorepo above it — so we flatten the
  // root biome config + template overrides into a single standalone biome.json.
  const rootBiomeSrc = monorepoRoot ? resolve(monorepoRoot, 'biome.json') : null;
  const templateBiomePath = resolve(dest, 'biome.json');

  let rootConfig: Record<string, unknown> = {};
  if (rootBiomeSrc && existsSync(rootBiomeSrc)) {
    rootConfig = JSON.parse(readFileSync(rootBiomeSrc, 'utf8'));
  } else {
    // Scaffolding from GitHub — fetch the monorepo's root biome.json so the
    // standalone config stays in sync with the source of truth.
    const url =
      'https://raw.githubusercontent.com/vobase/vobase/main/biome.json';
    const res = await fetch(url);
    if (res.ok) {
      rootConfig = JSON.parse(await res.text());
    } else {
      console.warn(
        `${dim('!')} Could not fetch root biome.json (${res.status}) — generating minimal config`,
      );
    }
  }

  // Capture template-specific overrides before we overwrite the file
  let templateOverrides: unknown[] = [];
  if (existsSync(templateBiomePath)) {
    try {
      const templateConfig = JSON.parse(
        readFileSync(templateBiomePath, 'utf8'),
      );
      if (Array.isArray(templateConfig.overrides)) {
        templateOverrides = templateConfig.overrides;
      }
    } catch {
      // ignore — template's biome.json may be the extends-// shape which we drop
    }
  }

  const biomeConfig: Record<string, unknown> = {
    ...rootConfig,
    $schema: './node_modules/@biomejs/biome/configuration_schema.json',
    files: {
      ...(typeof rootConfig.files === 'object' && rootConfig.files !== null
        ? (rootConfig.files as Record<string, unknown>)
        : {}),
      includes: [
        '**',
        '!dist',
        '!.omc',
        '!.claude',
        '!**/*.gen.ts',
        '!**/*.generated.ts',
        '!src/components/ai-elements',
        '!src/components/data-table',
        '!src/components/ui',
        '!src/lib/store',
        '!src/lib/table-schema',
        '!src/lib/compose-refs.ts',
      ],
    },
    overrides: [
      ...(Array.isArray(rootConfig.overrides) ? rootConfig.overrides : []),
      ...templateOverrides,
    ],
  };
  // `extends` is a monorepo-only concept — strip if the root config had it
  delete biomeConfig.extends;

  writeFileSync(biomePath, `${JSON.stringify(biomeConfig, null, 2)}\n`);
  console.log(`${green('✓')} Generated biome.json`);
}

// --- Generate knip.json (standalone, single-project config) ---
const knipPath = resolve(dest, 'knip.json');
{
  const knipConfig = {
    $schema: 'https://unpkg.com/knip@6/schema.json',
    tags: ['-lintignore'],
    entry: [
      'server.ts',
      'src/main.tsx',
      'scripts/*.ts',
      'vobase.config.ts',
      'drizzle.config.ts',
      'vite.config.ts',
      'modules/*/index.ts',
      'modules/*/seed.ts',
      'modules/seed-types.ts',
    ],
    project: [
      'src/**/*.{ts,tsx}',
      'modules/**/*.{ts,tsx}',
      'scripts/**/*.ts',
      '*.config.ts',
    ],
    ignore: [
      'src/components/ai-elements/**',
      'src/components/data-table/**',
      'src/components/ui/**',
      'src/lib/store/**',
      'src/lib/table-schema/**',
      'src/lib/compose-refs.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    ignoreDependencies: [
      'shadcn',
      'mastra',
      '@fontsource-variable/geist',
      'tailwindcss',
      'tw-animate-css',
    ],
  };
  writeFileSync(knipPath, `${JSON.stringify(knipConfig, null, 2)}\n`);
  console.log(`${green('✓')} Generated knip.json`);
}

if (!templateMode) {
  // --- Copy .env.example → .env with a real secret ---
  const envExample = resolve(dest, '.env.example');
  const envFile = resolve(dest, '.env');
  if (existsSync(envExample) && !existsSync(envFile)) {
    let env = readFileSync(envExample, 'utf8');
    const secret = randomBytes(32).toString('base64url');
    env = env.replace(/BETTER_AUTH_SECRET=.*/, `BETTER_AUTH_SECRET=${secret}`);
    writeFileSync(envFile, env);
    console.log(`${green('✓')} Generated .env with BETTER_AUTH_SECRET`);
  }

  // --- Create data directory ---
  mkdirSync(resolve(dest, 'data'), { recursive: true });
}

// --- Install dependencies ---
console.log(`\n${bold('Installing dependencies...')}`);
await $`bun install`.cwd(dest);
console.log(`${green('✓')} Dependencies installed`);

// --- Generate routes ---
console.log(`${bold('Generating routes...')}`);
await $`bun run scripts/generate.ts`.cwd(dest);
console.log(`${green('✓')} Routes generated`);

if (!templateMode) {
  // --- Set up database (fixtures → schema → seed) ---
  console.log(`${bold('Setting up database...')}`);
  await $`bun run db:push`.cwd(dest);
  console.log(`${green('✓')} Database schema pushed`);

  console.log(`${bold('Seeding admin user...')}`);
  await $`bun run db:seed`.cwd(dest);
}

console.log(`
${green('Done!')} Your vobase project is ready.
${
  isCurrent
    ? ''
    : `
  ${dim('$')} cd ${name}`
}
  ${dim('$')} bun run dev
`);
