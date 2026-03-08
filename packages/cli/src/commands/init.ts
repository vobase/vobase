import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadTemplate } from 'giget';

const TEMPLATE_SOURCE = 'github:vobase/vobase/packages/cli/template';

export async function runInit(
  projectName: string,
  options: { targetDir?: string } = {},
): Promise<void> {
  const targetDirectory =
    options.targetDir ?? resolve(process.cwd(), projectName);

  if (await pathExists(targetDirectory)) {
    throw new Error(`Target directory already exists: ${targetDirectory}`);
  }

  const cliVersion = await resolveCliVersion();

  console.log(`Downloading template...`);
  await downloadTemplate(TEMPLATE_SOURCE, {
    dir: targetDirectory,
    force: true,
  });

  await postProcess(targetDirectory, {
    projectName: basename(targetDirectory),
    cliVersion,
  });

  await runCommand(['bun', 'install'], targetDirectory);
  await runCommand(['bunx', 'vobase', 'generate'], targetDirectory);

  console.log(`✓ Created project: ${projectName}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${projectName}`);
  console.log('  bunx drizzle-kit push   # Push schema to dev database');
  console.log('  bunx vobase dev         # Start dev server');
}

const SKIP_ENTRIES = new Set([
  'node_modules',
  'dist',
  'data',
  '.turbo',
  '.tanstack',
  '.env',
  'packages',
  'migrations',
  'bun.lock',
  'bun.lockb',
]);

const SKIP_FILENAMES = new Set([
  'routeTree.gen.ts',
]);

async function postProcess(
  directory: string,
  options: { projectName: string; cliVersion: string },
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry.name) || SKIP_FILENAMES.has(entry.name)) {
      continue;
    }

    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      await postProcess(entryPath, options);
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    const content = await readFile(entryPath, 'utf8');
    let output = content.replaceAll(
      '{{PROJECT_NAME}}',
      options.projectName,
    );
    output = output.replaceAll(
      '"workspace:*"',
      `"^${options.cliVersion}"`,
    );
    output = output.replaceAll(
      '@vobase/template',
      options.projectName,
    );

    if (output !== content) {
      await writeFile(entryPath, output, 'utf8');
    }
  }
}

async function resolveCliVersion(): Promise<string> {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDirectory, '../package.json'),
    resolve(currentDirectory, '../../package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const packageJson = JSON.parse(await readFile(candidate, 'utf8'));
      if (packageJson.name === '@vobase/cli') return packageJson.version ?? '0.1.0';
    } catch {}
  }
  return '0.1.0';
}

async function runCommand(command: string[], cwd: string): Promise<void> {
  const childProcess = Bun.spawn(command, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  const exitCode = await childProcess.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited with code ${exitCode}`);
  }
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
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
