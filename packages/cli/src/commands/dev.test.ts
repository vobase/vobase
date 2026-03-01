import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';

import { buildDevCommands } from './dev';

const createdDirs: string[] = [];

async function createTempCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'vobase-dev-test-'));
  createdDirs.push(cwd);
  return cwd;
}

afterAll(async () => {
  for (const cwd of createdDirs) {
    await rm(cwd, { recursive: true, force: true });
  }
});

describe('buildDevCommands', () => {
  it('includes backend and frontend commands when vite.config.ts exists', async () => {
    const cwd = await createTempCwd();
    await writeFile(resolve(cwd, 'vite.config.ts'), 'export default {};');

    const commands = await buildDevCommands(cwd);

    expect(commands).toHaveLength(2);
    expect(commands).toEqual([
      {
        command: 'bun --watch run server.ts',
        name: 'backend',
        prefixColor: 'blue',
        env: { PORT: '3000' },
      },
      {
        command: 'bunx vite',
        name: 'frontend',
        prefixColor: 'green',
      },
    ]);
  });

  it('includes only backend command when vite config is absent', async () => {
    const cwd = await createTempCwd();

    const commands = await buildDevCommands(cwd);

    expect(commands).toEqual([
      {
        command: 'bun --watch run server.ts',
        name: 'backend',
        prefixColor: 'blue',
        env: { PORT: '3000' },
      },
    ]);
  });

  it('builds expected labels and commands when vite.config.js exists', async () => {
    const cwd = await createTempCwd();
    await writeFile(resolve(cwd, 'vite.config.js'), 'export default {};');

    const commands = await buildDevCommands(cwd);

    expect(commands[0]).toMatchObject({
      command: 'bun --watch run server.ts',
      name: 'backend',
      prefixColor: 'blue',
    });
    expect(commands[1]).toMatchObject({
      command: 'bunx vite',
      name: 'frontend',
      prefixColor: 'green',
    });
  });

  it('uses backend port from vobase.config.ts when provided', async () => {
    const cwd = await createTempCwd();
    await writeFile(
      resolve(cwd, 'vobase.config.ts'),
      'export default { server: { port: 4100 } };',
    );

    const commands = await buildDevCommands(cwd);

    expect(commands[0]?.env).toEqual({ PORT: '4100' });
  });
});
