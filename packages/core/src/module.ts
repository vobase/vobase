import type { Hono } from 'hono';

import { validation } from './errors';
import type { JobDefinition } from './job';

const MODULE_NAME_PATTERN = /^[a-z0-9-]+$/;
const RESERVED_MODULE_NAMES = new Set(['auth', 'mcp', 'health', 'api']);

export interface VobaseModule {
  name: string;
  schema: Record<string, unknown>;
  routes: Hono;
  jobs?: JobDefinition[];
  pages?: Record<string, string>;
  seed?: () => Promise<void>;
}

export interface DefineModuleConfig {
  name: string;
  schema: Record<string, unknown>;
  routes: Hono;
  jobs?: JobDefinition[];
  pages?: Record<string, string>;
  seed?: () => Promise<void>;
}

export function defineModule(config: DefineModuleConfig): VobaseModule {
  if (!config.name.trim()) {
    throw validation(
      { name: config.name },
      'Module name must be a non-empty string',
    );
  }

  if (!MODULE_NAME_PATTERN.test(config.name)) {
    throw validation(
      { name: config.name },
      'Module name must use lowercase alphanumeric characters and hyphens only',
    );
  }

  if (RESERVED_MODULE_NAMES.has(config.name)) {
    throw validation(
      { name: config.name },
      `Module name "${config.name}" is reserved`,
    );
  }

  if (
    typeof config.schema !== 'object' ||
    config.schema === null ||
    Array.isArray(config.schema) ||
    Object.keys(config.schema).length === 0
  ) {
    throw validation(
      { schema: config.schema },
      'Module schema must be a non-empty object',
    );
  }

  if (
    typeof config.routes !== 'object' ||
    config.routes === null ||
    typeof config.routes.get !== 'function'
  ) {
    throw validation(
      { routes: config.routes },
      'Module routes must be a Hono router instance',
    );
  }

  return Object.freeze({ ...config });
}
