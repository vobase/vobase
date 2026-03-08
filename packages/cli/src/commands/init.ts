import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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
    const entries = await readdir(targetDirectory);
    const nonEmpty = entries.filter((e) => e !== '.git' && e !== '.gitignore');
    if (nonEmpty.length > 0) {
      await ensureGitClean(targetDirectory);
    }
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

  await mkdir(join(targetDirectory, 'data'), { recursive: true });
  await runCommand(['bun', 'install'], targetDirectory);
  await runCommand(['bunx', 'vobase', 'generate'], targetDirectory);
  await runCommand(['bunx', 'drizzle-kit', 'push'], targetDirectory);

  const displayName = basename(targetDirectory);
  console.log(`✓ Created project: ${displayName}`);
  console.log('');
  console.log('Next steps:');
  if (projectName !== '.') {
    console.log(`  cd ${projectName}`);
  }
  console.log('  bunx vobase dev   # Start dev server');
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

async function ensureGitClean(directory: string): Promise<void> {
  try {
    const result = Bun.spawnSync(['git', 'status', '--porcelain'], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Directory "${directory}" is not empty and not a git repository. ` +
          'Use an empty directory or a clean git repo.',
      );
    }
    const output = result.stdout.toString().trim();
    if (output.length > 0) {
      throw new Error(
        `Directory "${directory}" has uncommitted changes. ` +
          'Please commit or stash your changes before running init.',
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Directory')) {
      throw error;
    }
    throw new Error(
      `Directory "${directory}" is not empty and not a git repository. ` +
        'Use an empty directory or a clean git repo.',
    );
  }
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
