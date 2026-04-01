#!/usr/bin/env bun
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
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
const agentsDir = resolve(dest, '.agents', 'skills');
const claudeSkillsDir = resolve(dest, '.claude', 'skills');
if (monorepoRoot) {
  const srcSkills = resolve(monorepoRoot, '.agents/skills');
  if (existsSync(srcSkills)) {
    cpSync(srcSkills, agentsDir, { recursive: true });
  }
} else {
  await downloadTemplate('github:vobase/vobase/.agents/skills', {
    dir: agentsDir,
    force: true,
  });
}
mkdirSync(claudeSkillsDir, { recursive: true });
for (const skill of readdirSync(agentsDir)) {
  if (skill.startsWith('.')) continue;
  const target = relative(claudeSkillsDir, resolve(agentsDir, skill));
  const link = resolve(claudeSkillsDir, skill);
  if (!existsSync(link)) {
    symlinkSync(target, link);
  }
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

// --- Generate biome.json (standalone, replacing monorepo-specific extends) ---
const biomePath = resolve(dest, 'biome.json');
{
  const biomeConfig = {
    $schema: 'node_modules/@biomejs/biome/configuration_schema.json',
    vcs: { enabled: true, clientKind: 'git', useIgnoreFile: true },
    files: {
      includes: [
        '**',
        '!dist',
        '!.omc',
        '!.agents',
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
    linter: {
      enabled: true,
      domains: {
        project: 'recommended',
        react: 'recommended',
        test: 'recommended',
      },
      rules: { recommended: true },
    },
    formatter: { enabled: true, indentStyle: 'space', indentWidth: 2 },
    javascript: { formatter: { quoteStyle: 'single' } },
    css: { parser: { tailwindDirectives: true } },
    assist: {
      enabled: true,
      actions: {
        source: {
          organizeImports: {
            level: 'on',
            options: {
              groups: [
                [':NODE:'],
                [':URL:', ':PACKAGE:', ':PACKAGE_WITH_PROTOCOL:'],
                ':BLANK_LINE:',
                ['#*', '#*/**', ':ALIAS:'],
                [':PATH:'],
              ],
            },
          },
        },
      },
    },
    overrides: [
      {
        includes: ['modules/knowledge-base/connectors/sharepoint.ts'],
        linter: { rules: { suspicious: { noTsIgnore: 'off' } } },
      },
    ],
  };
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
