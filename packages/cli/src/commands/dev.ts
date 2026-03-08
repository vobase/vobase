import { resolve } from 'node:path';
import concurrently from 'concurrently';

const DEFAULT_BACKEND_PORT = 3000;
const BACKEND_COMMAND = 'bun --watch run server.ts';

export type DevCommand = {
  command: string;
  name: 'backend' | 'frontend';
  prefixColor: 'blue' | 'green';
  env?: Record<string, string>;
};

export async function resolveBackendPort(cwd: string): Promise<number> {
  const configPath = resolve(cwd, 'vobase.config.ts');
  if (!(await Bun.file(configPath).exists())) {
    return DEFAULT_BACKEND_PORT;
  }

  const configModule = await import(configPath).catch(() => null);
  const config = configModule?.default;
  const rawPort = config?.server?.port ?? config?.port;

  if (typeof rawPort === 'number' && Number.isInteger(rawPort) && rawPort > 0) {
    return rawPort;
  }

  if (typeof rawPort === 'string') {
    const parsedPort = Number.parseInt(rawPort, 10);
    if (Number.isInteger(parsedPort) && parsedPort > 0) {
      return parsedPort;
    }
  }

  return DEFAULT_BACKEND_PORT;
}

export async function buildDevCommands(cwd: string): Promise<DevCommand[]> {
  const backendPort = await resolveBackendPort(cwd);
  const backendCommand: DevCommand = {
    command: BACKEND_COMMAND,
    name: 'backend',
    prefixColor: 'blue',
    env: { PORT: String(backendPort) },
  };

  const viteConfigTsPath = resolve(cwd, 'vite.config.ts');
  const viteConfigJsPath = resolve(cwd, 'vite.config.js');
  const hasViteConfig =
    (await Bun.file(viteConfigTsPath).exists()) ||
    (await Bun.file(viteConfigJsPath).exists());

  if (!hasViteConfig) {
    return [backendCommand];
  }

  return [
    backendCommand,
    {
      command: 'bunx vite',
      name: 'frontend',
      prefixColor: 'green',
    },
  ];
}

export async function runDev(options: { cwd?: string } = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const commands = await buildDevCommands(cwd);

  if (commands.length === 1) {
    const backendCommand = commands[0];
    if (!backendCommand) {
      throw new Error('No backend command configured');
    }

    const childProcess = Bun.spawn(['bun', '--watch', 'run', 'server.ts'], {
      cwd,
      env: {
        ...Bun.env,
        ...backendCommand.env,
      },
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    });

    const exitCode = await childProcess.exited;
    if (exitCode !== 0) {
      throw new Error(`bun --watch run server.ts exited with code ${exitCode}`);
    }

    return;
  }

  const { result } = concurrently(commands, {
    cwd,
    killOthersOn: ['failure'],
  });

  await result;
}
