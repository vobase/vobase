#!/usr/bin/env bun

import { runDev } from './commands/dev';
import { generate } from './commands/generate';
import { runInit } from './commands/init';
import { runDbMigrate } from './commands/db-migrate';
import { runDbGenerate } from './commands/db-generate';
import { runDbPush } from './commands/db-push';
import { runAddSkill } from './commands/add-skill';

export const HELP_TEXT = `vobase <command>

Commands:
  generate           Generate routes.ts and modules/system/schema.ts
  db:migrate         Run drizzle-kit migrations with auto-backup
  db:generate        Generate migration files via drizzle-kit
  db:push            Push schema changes directly to database
  dev                Start backend (and frontend when vite config exists)
  init [name]        Create a new vobase project (omit name for current dir)
  add skill <name>      Add a skill to .agents/skills
  add skill --list      List available skills
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

  if (command === 'db:migrate') {
    await runDbMigrate();
    return;
  }

  if (command === 'db:generate') {
    await runDbGenerate();
    return;
  }

  if (command === 'db:push') {
    await runDbPush();
    return;
  }

  if (command === 'dev') {
    await runDev();
    return;
  }

  if (command === 'init') {
    const [projectName] = rest;
    if (projectName === undefined || projectName.length === 0) {
      await runInit('.', { targetDir: process.cwd() });
    } else {
      await runInit(projectName);
    }
    return;
  }

  if (command === 'add') {
    const [subcommand, ...skillArgs] = rest;
    if (subcommand === 'skill') {
      await runAddSkill(skillArgs);
      return;
    }
    if (subcommand === undefined) {
      console.error('Missing subcommand: vobase add <subcommand>');
      console.log(HELP_TEXT);
      process.exitCode = 1;
      return;
    }
    console.error(`Unknown subcommand: vobase add ${subcommand}`);
    console.log(HELP_TEXT);
    process.exitCode = 1;
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
