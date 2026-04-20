/**
 * `defineModule` — runtime module contract.
 *
 * Validates the in-memory module shape at boot against `src/contracts/module-shape.ts`
 * (shared with `scripts/check-module-shape.ts` — no duplication between
 * runtime enforcement and CI lint).
 */
import type { PluginContext } from '@server/contracts/plugin-context'
import type { Hono } from 'hono'

export interface ModuleHttpRoutes {
  /** Mount prefix, e.g. `/api/inbox`. */
  basePath: string
  /** The module's Hono router (from `handlers/index.ts`). */
  handler: Hono
  /**
   * When true, all requests to `basePath/*` go through a session-auth
   * middleware that 401s unauthenticated callers. Public webhooks (HMAC-auth)
   * leave this `false`.
   */
  requireSession?: boolean
}

export interface ModuleManifest {
  /** Declarative capabilities this module advertises to other modules. */
  provides: {
    tools?: readonly string[]
    commands?: readonly string[]
    observers?: readonly string[]
    mutators?: readonly string[]
    skills?: readonly string[]
    materializers?: readonly string[]
    channels?: readonly string[]
  }
  /** Capability tokens this module needs to run (checked at boot). */
  permissions: readonly string[]
}

export interface ModuleDef {
  name: string
  version: string
  /** Names of modules that MUST initialize first. */
  requires?: readonly string[]
  manifest: ModuleManifest
  /**
   * HTTP surface declaration. When present, `bootModules()` mounts
   * `handler` at `basePath` and optionally wraps it in session auth.
   */
  routes?: ModuleHttpRoutes
  /**
   * Boot-time predicate: when returns `false`, the module is skipped
   * entirely (no `init`, no route mount). Use for env-gated modules
   * (e.g. dev-only channels).
   */
  enabled?: (env: NodeJS.ProcessEnv) => boolean
  /** Boot-time hook — the ONLY place to register tools/observers/mutators/etc. */
  init(ctx: PluginContext): void | Promise<void>
}

export interface ModuleInstance extends ModuleDef {
  readonly __kind: 'vobase-module'
}

export class InvalidModuleError extends Error {
  constructor(
    public readonly moduleName: string,
    public readonly reason: string,
  ) {
    super(`invalid module "${moduleName}": ${reason}`)
    this.name = 'InvalidModuleError'
  }
}

const MODULE_NAME_RE = /^[a-z][a-z0-9-]*$/
const VERSION_RE = /^\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?$/

export function defineModule(def: ModuleDef): ModuleInstance {
  if (!def.name || !MODULE_NAME_RE.test(def.name)) {
    throw new InvalidModuleError(def.name ?? '<unnamed>', 'name must be lowercase alphanumeric + hyphens')
  }
  if (!def.version || !VERSION_RE.test(def.version)) {
    throw new InvalidModuleError(def.name, `version "${def.version}" must be semver-shaped`)
  }
  if (!def.manifest?.provides || !Array.isArray(def.manifest.permissions)) {
    throw new InvalidModuleError(def.name, 'manifest must include `provides` + `permissions`')
  }
  if (typeof def.init !== 'function') {
    throw new InvalidModuleError(def.name, '`init` must be a function')
  }
  return { ...def, __kind: 'vobase-module' }
}

export function isModuleInstance(value: unknown): value is ModuleInstance {
  return typeof value === 'object' && value !== null && (value as { __kind?: string }).__kind === 'vobase-module'
}

/**
 * Topological sort of modules by `requires`. Used at boot to ensure dependent
 * modules see ports from their providers in `init(ctx)`.
 */
export function sortModules(modules: readonly ModuleInstance[]): ModuleInstance[] {
  const byName = new Map(modules.map((m) => [m.name, m]))
  const result: ModuleInstance[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(m: ModuleInstance): void {
    if (visited.has(m.name)) return
    if (visiting.has(m.name)) {
      throw new InvalidModuleError(m.name, 'circular requires detected')
    }
    visiting.add(m.name)
    for (const depName of m.requires ?? []) {
      const dep = byName.get(depName)
      if (!dep) {
        throw new InvalidModuleError(m.name, `requires unknown module "${depName}"`)
      }
      visit(dep)
    }
    visiting.delete(m.name)
    visited.add(m.name)
    result.push(m)
  }

  for (const m of modules) visit(m)
  return result
}
