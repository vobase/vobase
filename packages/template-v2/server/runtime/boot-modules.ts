import type { Hono, MiddlewareHandler } from 'hono'
import type { ModuleInstance } from './define-module'
import { sortModules } from './define-module'
import { createBootContext, emptyRegistrations, type ModuleRegistrations } from './plugin-context-factory'
import { checkProvidesId, validateManifests } from './validate-manifests'

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

  const enabled = ordered.filter((mod) => !mod.enabled || mod.enabled(process.env))
  validateManifests(enabled)

  for (const mod of enabled) {
    const { ctx, registrations } = createBootContext({
      ...input.ctx,
      moduleName: mod.name,
      allowedQueues: mod.manifest.queues,
      allowedBuckets: mod.manifest.buckets,
    })
    await mod.init(ctx)

    const declaredObservers = mod.manifest.provides.observers
    for (const observer of registrations.observers) {
      if (declaredObservers !== undefined) {
        checkProvidesId(mod.name, 'observer', observer.id, declaredObservers)
      }
    }
    const declaredMutators = mod.manifest.provides.mutators
    for (const mutator of registrations.mutators) {
      if (declaredMutators !== undefined) {
        checkProvidesId(mod.name, 'mutator', mutator.id, declaredMutators)
      }
    }

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
  into.observerFactories.push(...from.observerFactories)
  into.mutators.push(...from.mutators)
  into.materializers.push(...from.materializers)
  into.sideLoadContributors.push(...from.sideLoadContributors)
}
