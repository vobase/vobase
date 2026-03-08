export async function runDbGenerate(
  options: { cwd?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const spawnProcess = Bun.spawn(['bunx', 'drizzle-kit', 'generate'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await spawnProcess.exited;
  if (exitCode !== 0) {
    throw new Error(`drizzle-kit generate exited with code ${exitCode}`);
  }
}
