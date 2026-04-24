/**
 * Module collectors — materialize declarative surfaces from ordered modules.
 *
 * Slice 4b (`declarative-module-collector`) consumes these to flatten the
 * agent/web/jobs bundles at boot time. They are dormant in this slice — no
 * template call sites pull from them yet, but the shape is pinned by tests
 * so 4b can wire modules to them without churn.
 *
 * Ordering: every collector iterates `sortModules(modules)` and preserves
 * per-module declaration order within each array.
 */

import type { Hono, MiddlewareHandler } from 'hono'

import type { HarnessHooks } from '../harness/create-harness'
import type { AgentTool, CommandDef, SideLoadContributor, WorkspaceMaterializer } from '../harness/types'
import type { JobDef } from '../scheduler/types'
import { InvalidModuleError, type ModuleDef, sortModules } from './module-def'

export interface AgentContributions {
  tools: AgentTool[]
  listeners: Partial<HarnessHooks<unknown>>
  materializers: WorkspaceMaterializer[]
  commands: CommandDef[]
  sideLoad: SideLoadContributor[]
}

type ListenerSlotKey = keyof HarnessHooks<unknown>

const LISTENER_SLOTS: ListenerSlotKey[] = ['on_event', 'on_tool_call', 'on_tool_result']

export function collectAgentContributions<Db, Realtime>(
  modules: readonly ModuleDef<Db, Realtime>[],
): AgentContributions {
  const tools: AgentTool[] = []
  const materializers: WorkspaceMaterializer[] = []
  const commands: CommandDef[] = []
  const sideLoad: SideLoadContributor[] = []
  const listeners: Record<ListenerSlotKey, unknown[]> = {
    on_event: [],
    on_tool_call: [],
    on_tool_result: [],
  }

  for (const mod of sortModules([...modules])) {
    const agent = mod.agent
    if (!agent) continue
    if (agent.tools) tools.push(...agent.tools)
    if (agent.materializers) materializers.push(...agent.materializers)
    if (agent.commands) commands.push(...agent.commands)
    if (agent.sideLoad) sideLoad.push(...agent.sideLoad)
    if (agent.listeners) {
      for (const slot of LISTENER_SLOTS) {
        const entry = agent.listeners[slot]
        if (entry) listeners[slot].push(...entry)
      }
    }
  }

  const mergedListeners: Partial<HarnessHooks<unknown>> = {}
  for (const slot of LISTENER_SLOTS) {
    const list = listeners[slot]
    if (list.length > 0) {
      ;(mergedListeners as Record<ListenerSlotKey, unknown[]>)[slot] = list
    }
  }

  return { tools, listeners: mergedListeners, materializers, commands, sideLoad }
}

export interface CollectedWebRoute {
  basePath: string
  handler: Hono
  requireSession?: boolean
  middlewares: MiddlewareHandler[]
}

export function collectWebRoutes<Db, Realtime>(modules: readonly ModuleDef<Db, Realtime>[]): CollectedWebRoute[] {
  const out: CollectedWebRoute[] = []
  for (const mod of sortModules([...modules])) {
    const preferred = mod.web?.routes ?? mod.routes
    if (!preferred) continue
    out.push({
      basePath: preferred.basePath,
      handler: preferred.handler,
      requireSession: preferred.requireSession,
      middlewares: mod.web?.middlewares ?? [],
    })
  }
  return out
}

export function collectJobs<Db, Realtime>(modules: readonly ModuleDef<Db, Realtime>[]): JobDef[] {
  const out: JobDef[] = []
  const seen = new Map<string, string>()
  for (const mod of sortModules([...modules])) {
    if (!mod.jobs) continue
    for (const job of mod.jobs) {
      if (job.disabled) continue
      const prior = seen.get(job.name)
      if (prior) {
        throw new InvalidModuleError(mod.name, `duplicate job name "${job.name}" (already declared by "${prior}")`)
      }
      seen.set(job.name, mod.name)
      out.push(job)
    }
  }
  return out
}
