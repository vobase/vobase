import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function runMigrate(
  options: { cwd?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Step 1: Read DB path from vobase.config.ts, default to ./data/vobase.db
  let dbPath = './data/vobase.db';
  try {
    const configPath = resolve(cwd, 'vobase.config.ts');
    const config = await import(configPath).catch(() => null);
    if (config?.default?.database) {
      dbPath = config.default.database;
    }
  } catch {
    // Silently fall back to default
  }

  // Resolve to absolute path
  const absoluteDbPath = resolve(cwd, dbPath);

  // Step 2 & 3: Create backup if DB exists
  const dbExists = await Bun.file(absoluteDbPath).exists();
  if (dbExists) {
    // Create backup directory
    const backupDir = resolve(cwd, 'data/backups');
    await mkdir(backupDir, { recursive: true });

    // Generate ISO timestamp with colons replaced by dashes
    const now = new Date();
    const isoTimestamp =
      now.toISOString().split('.')[0]?.replace(/:/g, '-') ?? '';
    const backupPath = resolve(backupDir, `vobase-${isoTimestamp}.db`);

    // Copy DB to backup
    const dbFile = Bun.file(absoluteDbPath);
    const backupFile = Bun.file(backupPath);
    await Bun.write(backupFile, dbFile);
  }

  // Step 4 & 5: Run drizzle-kit migrate
  const spawnProcess = Bun.spawn(['bunx', 'drizzle-kit', 'migrate'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await spawnProcess.exited;
  if (exitCode !== 0) {
    throw new Error(`drizzle-kit migrate exited with code ${exitCode}`);
  }
}
