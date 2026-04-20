import type { Hono, MiddlewareHandler } from 'hono'
import type { ModuleInstance } from './define-module'
import { sortModules } from './define-module'
import { createBootContext, emptyRegistrations, type ModuleRegistrations } from './plugin-context-factory'

export interface BootModulesInput {
  modules: readonly ModuleInstance[]
  app: Hono
  ctx: Omit<Parameters<typeof createBootContext>[0], 'moduleName'>
  requireSession: MiddlewareHandler
}

/** Returns the combined registrations so the harness layer can seed per-wake contexts. */
export async function bootModules(input: BootModulesInput): Promise<ModuleRegistrations> {
  const aggregated = emptyRegistrations()
  const ordered = sortModules([...input.modules])

  for (const mod of ordered) {
    if (mod.enabled && !mod.enabled(process.env)) continue

    const { ctx, registrations } = createBootContext({ ...input.ctx, moduleName: mod.name })
    await mod.init(ctx)

    mergeRegistrations(aggregated, registrations)

    if (mod.routes) {
      const { basePath, handler, requireSession } = mod.routes
      if (requireSession) input.app.use(`${basePath}/*`, input.requireSession)
      input.app.route(basePath, handler)
    }
  }

  return aggregated
}

function mergeRegistrations(into: ModuleRegistrations, from: ModuleRegistrations): void {
  into.tools.push(...from.tools)
  into.skills.push(...from.skills)
  into.commands.push(...from.commands)
  into.channels.push(...from.channels)
  into.observers.push(...from.observers)
  into.mutators.push(...from.mutators)
  into.materializers.push(...from.materializers)
  into.sideLoadContributors.push(...from.sideLoadContributors)
}
