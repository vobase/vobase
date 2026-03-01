#!/usr/bin/env bun

import { runDev } from './commands/dev';
import { generate } from './commands/generate';
import { runInit } from './commands/init';
import { runMigrate } from './commands/migrate';
import { runMigrateGenerate } from './commands/migrate-generate';

export const HELP_TEXT = `vobase <command>

Commands:
  generate           Generate routes.ts and modules/system/schema.ts
  migrate            Run drizzle-kit migrations with auto-backup
  migrate:generate   Generate migration files via drizzle-kit
  dev                Start backend (and frontend when vite config exists)
  init <name>        Create a new vobase project
`;

export async function main(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const [command, ...rest] = args;

  if (command === undefined || command === '--help' || command === '-h') {
    console.log(HELP_TEXT);
    return;
  }

  if (command === 'generate') {
    const result = await generate();
    console.log(`Generated ${result.routesPath}`);
    console.log(`Generated ${result.schemaPath}`);
    return;
  }

  if (command === 'migrate') {
    await runMigrate();
    return;
  }

  if (command === 'migrate:generate') {
    await runMigrateGenerate();
    return;
  }

  if (command === 'dev') {
    await runDev();
    return;
  }

  if (command === 'init') {
    const [projectName] = rest;
    if (projectName === undefined || projectName.length === 0) {
      console.error('Missing project name: vobase init <name>');
      console.log(HELP_TEXT);
      process.exitCode = 1;
      return;
    }

    await runInit(projectName);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log(HELP_TEXT);
  process.exitCode = 1;
}

if (import.meta.main) {
  await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`vobase failed: ${message}`);
    process.exitCode = 1;
  });
}
