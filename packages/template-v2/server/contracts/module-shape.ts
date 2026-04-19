/**
 * Single source of truth for per-module file layout. Consumed by:
 * - `server/runtime/define-module.ts` at runtime (boot-time validation)
 * - `scripts/check-module-shape.ts` at CI (pre-merge lint)
 *
 * Data only — no logic. Keeps runtime enforcement and CI lint in lock-step.
 */

export const REQUIRED_MODULE_FILES = [
  'module.ts',
  'manifest.ts',
  'schema.ts',
  'state.ts',
  'service/index.ts',
  'port.ts',
  'handlers/index.ts',
  'jobs.ts',
  'seed.ts',
  'README.md',
] as const

export const OPTIONAL_MODULE_DIRS = ['observers', 'mutators', 'workspace', 'pages', 'skills', 'reference'] as const

/** Max raw `wc -l` line count for any file under `modules/<name>/handlers/`. */
export const MAX_HANDLER_RAW_LOC = 200

/** Required YAML frontmatter keys in every module's `README.md`. */
export const REQUIRED_README_FRONTMATTER = ['name', 'version', 'provides', 'permissions'] as const

export type RequiredModuleFile = (typeof REQUIRED_MODULE_FILES)[number]
export type OptionalModuleDir = (typeof OPTIONAL_MODULE_DIRS)[number]
