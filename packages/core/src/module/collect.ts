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
import type { AgentTool, SideLoadContributor, WorkspaceMaterializerFactory } from '../harness/types'
import type { JobDef } from '../scheduler/types'
import type { IndexContributor } from '../workspace/index-file-builder'
import { InvalidModuleError, type ModuleDef, type RoHintFn, sortModules } from './module-def'

export type { RoHintFn }

export interface AgentContributions<TCtx = unknown> {
  tools: AgentTool[]
  listeners: Partial<HarnessHooks<unknown>>
  /**
   * Wake-time materializer factories collected from every module's
   * `agent.materializers` slot. The wake builder invokes each factory with
   * a template-specific `WakeContext` to obtain concrete materializers.
   */
  materializers: WorkspaceMaterializerFactory<TCtx>[]
  sideLoad: SideLoadContributor[]
  /**
   * Module-contributed sections of the agent's `AGENTS.md` system document.
   * Each entry is an `IndexContributor` (priority + render fn). Used by the
   * agents module's materializer (which calls `generateAgentsMd`) to keep
   * the header content for a module's verbs colocated with the verb
   * definitions themselves. The runtime sorts by priority and joins with
   * blank lines.
   */
  agentsMd: IndexContributor[]
  /** Module-contributed RO-error hints. See `RoHintFn`. */
  roHints: RoHintFn[]
}

type ListenerSlotKey = keyof HarnessHooks<unknown>

const LISTENER_SLOTS: ListenerSlotKey[] = ['on_event', 'on_tool_call', 'on_tool_result']

export function collectAgentContributions<Db, Realtime, TCtx>(
  modules: readonly ModuleDef<Db, Realtime, TCtx>[],
): AgentContributions<TCtx> {
  const tools: AgentTool[] = []
  const materializers: WorkspaceMaterializerFactory<TCtx>[] = []
  const sideLoad: SideLoadContributor[] = []
  const agentsMd: IndexContributor[] = []
  const roHints: RoHintFn[] = []
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
    if (agent.sideLoad) sideLoad.push(...agent.sideLoad)
    if (agent.agentsMd) agentsMd.push(...agent.agentsMd)
    if (agent.roHints) roHints.push(...agent.roHints)
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

  return { tools, listeners: mergedListeners, materializers, sideLoad, agentsMd, roHints }
}

export interface CollectedWebRoute {
  basePath: string
  handler: Hono
  requireSession?: boolean
  middlewares: MiddlewareHandler[]
}

export function collectWebRoutes<Db, Realtime, TCtx>(
  modules: readonly ModuleDef<Db, Realtime, TCtx>[],
): CollectedWebRoute[] {
  const out: CollectedWebRoute[] = []
  for (const mod of sortModules([...modules])) {
    const preferred = mod.web?.routes
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

export function collectJobs<Db, Realtime, TCtx>(modules: readonly ModuleDef<Db, Realtime, TCtx>[]): JobDef[] {
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
