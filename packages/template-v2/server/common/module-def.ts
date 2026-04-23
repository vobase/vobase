/**
 * Narrow module shape — the post-slice-2c.3 replacement for
 * `server/runtime/define-module.ts`'s `ModuleDef` / `ModuleInstance`.
 *
 * A module is a plain object with a name, optional `requires` for dependency
 * ordering, optional HTTP route mount, and an `init(ctx)` hook that runs
 * once at boot. `ctx` is intentionally minimal: only the fields every init
 * actually reads (db, organizationId, jobs, realtime). Tool / observer /
 * command registration moved to named-export fields on the module itself
 * (`tools`, `on_event`, `commands`) — see `server/harness-config.ts`.
 */

import type { RealtimeService, ScopedScheduler } from '@server/common/port-types'
import type { ScopedDb } from '@server/contracts/scoped-db'
import type { Hono, MiddlewareHandler } from 'hono'

export interface ModuleInitCtx {
  readonly db: ScopedDb
  readonly organizationId: string
  readonly jobs: ScopedScheduler
  readonly realtime: RealtimeService
}

export interface ModuleRoutes {
  basePath: string
  handler: Hono
  requireSession?: boolean
}

export interface ModuleDef {
  name: string
  requires?: readonly string[]
  routes?: ModuleRoutes
  enabled?: (env: NodeJS.ProcessEnv) => boolean
  init(ctx: ModuleInitCtx): void | Promise<void>
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

export function sortModules(modules: readonly ModuleDef[]): ModuleDef[] {
  const byName = new Map(modules.map((m) => [m.name, m]))
  const result: ModuleDef[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(m: ModuleDef): void {
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

export async function bootModulesCollector(opts: {
  modules: readonly ModuleDef[]
  app: Hono
  requireSession: MiddlewareHandler
  ctx: ModuleInitCtx
}): Promise<void> {
  const ordered = sortModules([...opts.modules])
  const enabled = ordered.filter((m) => !m.enabled || m.enabled(process.env))
  for (const mod of enabled) {
    await mod.init(opts.ctx)
    if (mod.routes) {
      const { basePath, handler, requireSession } = mod.routes
      if (requireSession) opts.app.use(`${basePath}/*`, opts.requireSession)
      opts.app.route(basePath, handler)
    }
  }
}
