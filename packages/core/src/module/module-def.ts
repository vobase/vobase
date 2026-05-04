/**
 * Narrow module shape shared between runtime (core) and project template.
 *
 * A module is a plain object with a name, optional `requires` for dependency
 * ordering, declarative `web` / `agent` / `jobs` surfaces, and an `init(ctx)`
 * hook that runs once at boot.
 *
 * `ModuleInitCtx` and `ModuleDef` are generic over `Db` and `Realtime` so the
 * concrete database handle and realtime service can stay project-shaped while
 * the boot loop, sorter, and collectors live here. Template layers bind these
 * to their local `ScopedDb` / `RealtimeService` via a thin re-export barrel.
 */

import type { Hono, MiddlewareHandler } from 'hono'

import type { HarnessHooks } from '../harness/create-harness'
import type { AgentTool, SideLoadContributor, WorkspaceMaterializerFactory } from '../harness/types'
import type { RateLimiter } from '../rate-limits'
import type { JobDef, ScopedScheduler } from '../scheduler/types'
import type { CliVerbRegistry } from '../workspace/cli/registry'
import type { IndexContributor } from '../workspace/index-file-builder'

/**
 * Per-module RO-error hint. Returns a recovery message for a known RO path
 * owned by the module, or `null` to fall through to the next module's hint.
 * The wake builder chains every module's hint and returns the first non-null
 * match; if no module claims the path, the harness emits its generic RO
 * error message. Each module owns hints for the paths it materializes.
 */
export type RoHintFn = (path: string) => string | null

export interface ModuleInitCtx<Db = unknown, Realtime = unknown> {
  readonly db: Db
  readonly organizationId: string
  readonly jobs: ScopedScheduler
  readonly realtime: Realtime
  /**
   * CLI verb registry. Modules call `ctx.cli.register(defineCliVerb({ ... }))`
   * during `init` to publish a verb. The catalog endpoint serializes this
   * registry; HTTP-RPC and in-process transports both dispatch through it.
   */
  readonly cli: CliVerbRegistry
  /**
   * Sliding-window rate limiter backed by `infra.rate_limits`. Modules call
   * `ctx.rateLimits.acquire(key, limit, windowSeconds)` to gate inbound webhook
   * volume, outbound provider calls, or per-tenant quotas. State persists in
   * Postgres (uses `now()`) so the limit is shared across template instances
   * and survives restarts.
   */
  readonly rateLimits: RateLimiter
}

export interface ModuleRoutes {
  basePath: string
  /**
   * The module's Hono router. Typed as `any` for env/schema so modules can
   * carry their own variables (e.g. `OrganizationEnv` from the template's auth
   * middleware). Hono's first generic is invariant, so `Hono<Env>` would
   * reject `Hono<OrganizationEnv>` even though it's structurally a subtype.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Hono env is invariant — see comment above
  handler: Hono<any, any, string>
  requireSession?: boolean
}

export interface ModuleDef<Db = unknown, Realtime = unknown, TCtx = unknown> {
  name: string
  requires?: readonly string[]
  enabled?: (env: NodeJS.ProcessEnv) => boolean
  init(ctx: ModuleInitCtx<Db, Realtime>): void | Promise<void>

  web?: {
    routes: ModuleRoutes
    middlewares?: MiddlewareHandler[]
  }
  agent?: {
    tools?: AgentTool[]
    listeners?: Partial<HarnessHooks<unknown>>
    /**
     * Wake-time materializer factories. Each factory receives the template's
     * `WakeContext` (threaded via the third generic) and returns concrete
     * materializers. The collector flattens factories across modules; the
     * wake builder invokes them per wake.
     */
    materializers?: WorkspaceMaterializerFactory<TCtx>[]
    sideLoad?: SideLoadContributor[]
    /**
     * Module-contributed sections of the agent's `AGENTS.md` system document.
     * Each entry is an `IndexContributor` (priority + render fn). The
     * `generateAgentsMd` builder sorts by priority and joins with blank lines,
     * so each module owns the prompt content describing the verbs/patterns it
     * contributes — colocated with the verb definitions themselves.
     */
    agentsMd?: IndexContributor[]
    /** Module-contributed RO-error hints. See `RoHintFn`. */
    roHints?: RoHintFn[]
  }
  jobs?: JobDef[]
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

export function sortModules<Db, Realtime, TCtx>(
  modules: readonly ModuleDef<Db, Realtime, TCtx>[],
): ModuleDef<Db, Realtime, TCtx>[] {
  const byName = new Map(modules.map((m) => [m.name, m]))
  const result: ModuleDef<Db, Realtime, TCtx>[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(m: ModuleDef<Db, Realtime, TCtx>): void {
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

export async function bootModules<Db, Realtime, TCtx>(opts: {
  modules: readonly ModuleDef<Db, Realtime, TCtx>[]
  app: Hono
  requireSession: MiddlewareHandler
  ctx: ModuleInitCtx<Db, Realtime>
}): Promise<void> {
  const ordered = sortModules([...opts.modules])
  const enabled = ordered.filter((m) => !m.enabled || m.enabled(process.env))
  for (const mod of enabled) {
    await mod.init(opts.ctx)
    const mountable = mod.web?.routes
    if (mountable) {
      const { basePath, handler, requireSession } = mountable
      if (requireSession) opts.app.use(`${basePath}/*`, opts.requireSession)
      opts.app.route(basePath, handler)
    }
  }
}
