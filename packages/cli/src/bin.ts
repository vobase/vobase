#!/usr/bin/env bun
import { generate } from './commands/generate';

const HELP_TEXT = `vobase <command>

Commands:
  generate  Generate routes.ts and modules/system/schema.ts
`;

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

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

  console.error(`Unknown command: ${command}`);
  console.log(HELP_TEXT);
  process.exitCode = 1;
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`vobase failed: ${message}`);
  process.exitCode = 1;
});
