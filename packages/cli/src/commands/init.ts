import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runInit(
  projectName: string,
  options: { targetDir?: string } = {},
): Promise<void> {
  const targetDirectory = options.targetDir ?? resolve(process.cwd(), projectName);

  if (await pathExists(targetDirectory)) {
    throw new Error(`Target directory already exists: ${targetDirectory}`);
  }

  const templateDirectory = await resolveTemplateDirectory();
  await mkdir(targetDirectory, { recursive: true });
  await copyTemplateDirectory(templateDirectory, targetDirectory, {
    projectName: basename(targetDirectory),
  });

  await runCommand(['bun', 'install'], targetDirectory);
  await runCommand(['bunx', 'vobase', 'generate'], targetDirectory);

  console.log(`✓ Created project: ${projectName}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${projectName}`);
  console.log('  bun x @better-auth/cli generate  # Generate auth tables schema');
  console.log('  bunx vobase migrate               # Run initial migrations');
  console.log('  bunx vobase dev                   # Start dev server');
}

async function copyTemplateDirectory(
  sourceDirectory: string,
  targetDirectory: string,
  options: { projectName: string },
): Promise<void> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyTemplateDirectory(sourcePath, targetPath, options);
      continue;
    }

    const sourceContent = await readFile(sourcePath, 'utf8');
    const outputContent = sourceContent.replaceAll('{{PROJECT_NAME}}', options.projectName);
    await writeFile(targetPath, outputContent, 'utf8');
  }
}

async function resolveTemplateDirectory(): Promise<string> {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDirectory, '../../template'),
    resolve(currentDirectory, '../template'),
    resolve(currentDirectory, './template'),
    resolve(currentDirectory, '../../../template'),
    resolve(process.cwd(), 'packages/cli/template'),
    resolve(process.cwd(), 'template'),
  ];

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate CLI template directory');
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

async function directoryExists(pathValue: string): Promise<boolean> {
  try {
    const pathStats = await stat(pathValue);
    return pathStats.isDirectory();
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return false;
    }

    throw error;
  }
}

function isErrnoCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
