import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MODULE_NAME_PATTERN = /^[a-z0-9-]+$/;

export interface GenerateOptions {
  cwd?: string;
}

export interface GenerateResult {
  routesPath: string;
  schemaPath: string;
  modules: string[];
}

export const SYSTEM_SCHEMA_SOURCE = `import { customAlphabet } from 'nanoid';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const createNanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

const nanoidPrimaryKey = () => text('id').primaryKey().$defaultFn(() => createNanoid());

export const auditLog = sqliteTable('_audit_log', {
  id: nanoidPrimaryKey(),
  event: text('event').notNull(),
  actorId: text('actor_id'),
  actorEmail: text('actor_email'),
  ip: text('ip'),
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sequences = sqliteTable('_sequences', {
  id: nanoidPrimaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const recordAudits = sqliteTable('_record_audits', {
  id: nanoidPrimaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  oldData: text('old_data'),
  newData: text('new_data'),
  changedBy: text('changed_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});
`;

export function buildRoutesSource(moduleNames: string[]): string {
  const sortedModuleNames = [...moduleNames].sort((left, right) =>
    left.localeCompare(right),
  );
  const children =
    sortedModuleNames.length === 0
      ? '[]'
      : `[\n${sortedModuleNames.map(buildModuleRoute).join('\n')}\n]`;

  return [
    "import { rootRoute, route, physical } from '@tanstack/virtual-file-routes';",
    '',
    `export const routes = rootRoute('root.tsx', ${children});`,
    '',
  ].join('\n');
}

export async function findModulesWithPages(
  projectRoot: string,
): Promise<string[]> {
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

export async function generate(
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const cwd = options.cwd ?? process.cwd();
  const modules = await findModulesWithPages(cwd);

  const routesPath = join(cwd, 'src', 'routes.ts');
  await mkdir(dirname(routesPath), { recursive: true });
  await writeFile(routesPath, buildRoutesSource(modules), 'utf8');

  const schemaPath = join(cwd, 'modules', 'system', 'schema.ts');
  await mkdir(dirname(schemaPath), { recursive: true });
  await writeFile(schemaPath, SYSTEM_SCHEMA_SOURCE, 'utf8');

  return {
    routesPath,
    schemaPath,
    modules,
  };
}

function buildModuleRoute(moduleName: string): string {
  return [
    `  route('/${moduleName}', '../modules/${moduleName}/pages/layout.tsx', [`,
    `    physical('../modules/${moduleName}/pages/'),`,
    '  ]),',
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
