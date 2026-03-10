/**
 * Route generation script for vobase projects.
 *
 * Scans modules/ for directories containing pages/ subdirectories,
 * then generates src/routes.ts with TanStack virtual file routes.
 *
 * Usage: bun run scripts/generate.ts
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MODULE_NAME_PATTERN = /^[a-z0-9-]+$/;

async function findModulesWithPages(projectRoot: string): Promise<string[]> {
  const modulesDirectory = join(projectRoot, 'modules');

  let moduleEntries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    moduleEntries = await readdir(modulesDirectory, { withFileTypes: true });
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }

  const moduleNames = moduleEntries
    .filter(
      (entry) => entry.isDirectory() && MODULE_NAME_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const modulesWithPages: string[] = [];
  for (const moduleName of moduleNames) {
    const pagesDirectory = join(modulesDirectory, moduleName, 'pages');
    if (await directoryExists(pagesDirectory)) {
      modulesWithPages.push(moduleName);
    }
  }

  return modulesWithPages;
}

function buildModuleRoute(moduleName: string): string {
  return [
    `    route('/${moduleName}', '../modules/${moduleName}/pages/layout.tsx', [`,
    `      physical('../modules/${moduleName}/pages/'),`,
    '    ]),',
  ].join('\n');
}

function buildRoutesSource(moduleNames: string[]): string {
  const sortedModuleNames = [...moduleNames].sort((left, right) =>
    left.localeCompare(right),
  );
  const appChildren = [
    "    route('/', 'home.tsx'),",
    ...sortedModuleNames.map(buildModuleRoute),
  ];

  return [
    "import {",
    "  layout,",
    "  physical,",
    "  rootRoute,",
    "  route,",
    "} from '@tanstack/virtual-file-routes';",
    '',
    "export const routes = rootRoute('root.tsx', [",
    "  layout('auth', 'shell/auth/layout.tsx', [",
    "    route('/login', 'shell/auth/login.tsx'),",
    "    route('/signup', 'shell/auth/signup.tsx'),",
    '  ]),',
    "  layout('app', 'shell/app-layout.tsx', [",
    ...appChildren,
    '  ]),',
    ']);',
    '',
  ].join('\n');
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}

function isErrnoCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function main() {
  const cwd = process.cwd();
  const modules = await findModulesWithPages(cwd);

  const routesPath = join(cwd, 'src', 'routes.ts');
  await mkdir(dirname(routesPath), { recursive: true });
  await writeFile(routesPath, buildRoutesSource(modules), 'utf8');

  console.log(`Generated src/routes.ts with modules: ${modules.join(', ') || '(none)'}`);
}

main().catch((error) => {
  console.error('Generate failed:', error);
  process.exit(1);
});
