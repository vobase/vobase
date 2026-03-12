import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';

import { buildRoutesSource, generate, SYSTEM_SCHEMA_SOURCE } from './generate';

const tempProjects: string[] = [];

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'vobase-gen-'));
  tempProjects.push(projectRoot);
  return projectRoot;
}

async function createModulePages(
  projectRoot: string,
  moduleName: string,
): Promise<void> {
  const pagesDirectory = join(projectRoot, 'modules', moduleName, 'pages');
  await mkdir(pagesDirectory, { recursive: true });
  await Bun.write(
    join(pagesDirectory, 'layout.tsx'),
    'export default function Layout() { return null; }\n',
  );
}

describe('generate', () => {
  afterAll(async () => {
    await Promise.all(
      tempProjects.map((projectRoot) =>
        rm(projectRoot, { recursive: true, force: true }),
      ),
    );
  });

  it('writes sorted TanStack virtual routes for modules with pages directories', async () => {
    const projectRoot = await createTempProject();
    await createModulePages(projectRoot, 'invoicing');
    await createModulePages(projectRoot, 'crm');

    const result = await generate({ cwd: projectRoot });
    const routes = await readFile(result.routesPath, 'utf8');

    const expectedRoutes = [
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
      "    route('/', 'home.tsx'),",
      "    route('/crm', '../modules/crm/pages/layout.tsx', [",
      "      physical('../modules/crm/pages/'),",
      '    ]),',
      "    route('/invoicing', '../modules/invoicing/pages/layout.tsx', [",
      "      physical('../modules/invoicing/pages/'),",
      '    ]),',
      '  ]),',
      ']);',
      '',
    ].join('\n');

    expect(result.modules).toEqual(['crm', 'invoicing']);
    expect(routes).toBe(expectedRoutes);
  });

  it('is deterministic for repeated runs on the same project', async () => {
    const projectRoot = await createTempProject();
    await createModulePages(projectRoot, 'orders');
    await createModulePages(projectRoot, 'billing');

    await generate({ cwd: projectRoot });
    const firstRoutes = await readFile(join(projectRoot, 'src', 'routes.ts'), 'utf8');

    await generate({ cwd: projectRoot });
    const secondRoutes = await readFile(join(projectRoot, 'src', 'routes.ts'), 'utf8');

    expect(secondRoutes).toBe(firstRoutes);
  });

  it('writes a static system schema copy to modules/system/schema.ts', async () => {
    const projectRoot = await createTempProject();

    const result = await generate({ cwd: projectRoot });
    const schema = await readFile(result.schemaPath, 'utf8');

    expect(schema).toBe(SYSTEM_SCHEMA_SOURCE);
    expect(schema.includes('managed by @vobase/core')).toBe(true);
  });

  it('writes empty routes output when no modules are present', async () => {
    const projectRoot = await createTempProject();

    const result = await generate({ cwd: projectRoot });
    const routes = await readFile(result.routesPath, 'utf8');

    expect(result.modules).toEqual([]);
    expect(routes).toBe(buildRoutesSource([]));
    expect(routes).toContain("route('/', 'home.tsx')");
    expect(routes).toContain("route('/login', 'shell/auth/login.tsx')");
  });
});
