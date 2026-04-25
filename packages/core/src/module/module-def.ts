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
import type { AgentTool, CommandDef, SideLoadContributor, WorkspaceMaterializer } from '../harness/types'
import type { JobDef, ScopedScheduler } from '../scheduler/types'

export interface ModuleInitCtx<Db = unknown, Realtime = unknown> {
  readonly db: Db
  readonly organizationId: string
  readonly jobs: ScopedScheduler
  readonly realtime: Realtime
}

export interface ModuleRoutes {
  basePath: string
  handler: Hono
  requireSession?: boolean
}

export interface ModuleDef<Db = unknown, Realtime = unknown> {
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
    materializers?: WorkspaceMaterializer[]
    commands?: CommandDef[]
    sideLoad?: SideLoadContributor[]
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

export function sortModules<Db, Realtime>(modules: readonly ModuleDef<Db, Realtime>[]): ModuleDef<Db, Realtime>[] {
  const byName = new Map(modules.map((m) => [m.name, m]))
  const result: ModuleDef<Db, Realtime>[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(m: ModuleDef<Db, Realtime>): void {
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

export async function bootModules<Db, Realtime>(opts: {
  modules: readonly ModuleDef<Db, Realtime>[]
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
