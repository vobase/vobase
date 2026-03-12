import type { Hono } from 'hono';

import type { ModuleInitContext } from './contracts/module';
import { validation } from './infra/errors';
import type { JobDefinition } from './infra/job';

const MODULE_NAME_PATTERN = /^[a-z0-9-]+$/;
const BUILTIN_NAME_PATTERN = /^_[a-z0-9-]+$/;
const RESERVED_MODULE_NAMES = new Set(['auth', 'mcp', 'health', 'api']);

export interface VobaseModule {
  name: string;
  schema: Record<string, unknown>;
  routes: Hono;
  jobs?: JobDefinition[];
  pages?: Record<string, string>;
  seed?: () => Promise<void>;
  init?: (ctx: ModuleInitContext) => Promise<void> | void;
}

export interface DefineModuleConfig {
  name: string;
  schema: Record<string, unknown>;
  routes: Hono;
  jobs?: JobDefinition[];
  pages?: Record<string, string>;
  seed?: () => Promise<void>;
  init?: (ctx: ModuleInitContext) => Promise<void> | void;
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
    Array.isArray(config.schema)
  ) {
    throw validation(
      { schema: config.schema },
      'Module schema must be an object',
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

/**
 * Internal-only factory for built-in modules. Bypasses user-facing name
 * validation to allow the `_` prefix convention (e.g., `_audit`, `_sequences`).
 * Not exported in the public API (index.ts).
 */
export function defineBuiltinModule(config: DefineModuleConfig): VobaseModule {
  if (!config.name.trim()) {
    throw validation(
      { name: config.name },
      'Module name must be a non-empty string',
    );
  }

  if (!BUILTIN_NAME_PATTERN.test(config.name)) {
    throw validation(
      { name: config.name },
      'Built-in module name must start with _ and use lowercase alphanumeric characters and hyphens',
    );
  }

  // Built-in modules may have empty schemas (e.g., if they only read from other module tables)
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
