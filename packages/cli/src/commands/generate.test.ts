import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SYSTEM_SCHEMA_SOURCE, buildRoutesSource, generate } from './generate';

const tempProjects: string[] = [];

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'vobase-gen-'));
  tempProjects.push(projectRoot);
  return projectRoot;
}

async function createModulePages(projectRoot: string, moduleName: string): Promise<void> {
  const pagesDirectory = join(projectRoot, 'modules', moduleName, 'pages');
  await mkdir(pagesDirectory, { recursive: true });
  await Bun.write(join(pagesDirectory, 'layout.tsx'), 'export default function Layout() { return null; }\n');
}

describe('generate', () => {
  afterAll(async () => {
    await Promise.all(
      tempProjects.map((projectRoot) => rm(projectRoot, { recursive: true, force: true })),
    );
  });

  it('writes sorted TanStack virtual routes for modules with pages directories', async () => {
    const projectRoot = await createTempProject();
    await createModulePages(projectRoot, 'invoicing');
    await createModulePages(projectRoot, 'crm');

    const result = await generate({ cwd: projectRoot });
    const routes = await readFile(result.routesPath, 'utf8');

    const expectedRoutes = [
      "import { rootRoute, route, physical } from '@tanstack/virtual-file-routes';",
      '',
      "export const routes = rootRoute('root.tsx', [",
      "  route('/crm', 'modules/crm/pages/layout.tsx', [",
      "    physical('/crm', 'modules/crm/pages/'),",
      '  ]),',
      "  route('/invoicing', 'modules/invoicing/pages/layout.tsx', [",
      "    physical('/invoicing', 'modules/invoicing/pages/'),",
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
    const firstRoutes = await readFile(join(projectRoot, 'routes.ts'), 'utf8');

    await generate({ cwd: projectRoot });
    const secondRoutes = await readFile(join(projectRoot, 'routes.ts'), 'utf8');

    expect(secondRoutes).toBe(firstRoutes);
  });

  it('writes a static system schema copy to modules/system/schema.ts', async () => {
    const projectRoot = await createTempProject();

    const result = await generate({ cwd: projectRoot });
    const schema = await readFile(result.schemaPath, 'utf8');

    expect(schema).toBe(SYSTEM_SCHEMA_SOURCE);
    expect(schema.includes('export const auditLog')).toBe(true);
    expect(schema.includes('export const sequences')).toBe(true);
    expect(schema.includes('export const recordAudits')).toBe(true);
    expect(schema.includes('export * from')).toBe(false);
  });

  it('writes empty routes output when no modules are present', async () => {
    const projectRoot = await createTempProject();

    const result = await generate({ cwd: projectRoot });
    const routes = await readFile(result.routesPath, 'utf8');

    expect(result.modules).toEqual([]);
    expect(routes).toBe(buildRoutesSource([]));
    expect(routes).toContain("rootRoute('root.tsx', [])");
  });
});
