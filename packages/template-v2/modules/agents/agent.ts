/**
 * Agent-facing surfaces for the agents module.
 *
 * `tools` is the static subagent tool (surfaced via `collectAgentContributions`).
 *
 * Listeners and materializers are per-wake factories — they close over wake-time
 * state (`fs`, `tracker`, `agentDefinition`, `contactId`) that the collector
 * cannot know at boot. Wake handler composes them alongside the static bundle.
 *
 * Materializers render `/agents/<id>/AGENTS.md` (generated from the agent
 * definition + registered commands via core's `generateAgentsMd()`) and
 * `/agents/<id>/MEMORY.md` (the agent's working-memory blob, falls back to
 * the empty-memory stub).
 */

import type { AgentDefinition } from '@modules/agents/schema'
import type { AgentTool, CommandDef, WorkspaceMaterializer } from '@vobase/core'
import { generateAgentsMd } from '@vobase/core'

import { subagentTool } from './tools/shared/subagent'
import { sharedViewTools } from './tools/shared/views'

export { createMemoryDistillListener } from './observers/memory-distill'
export { createSseListener } from './observers/sse'
export { createWorkspaceSyncListener } from './observers/workspace-sync'
export { subagentTool } from './tools/shared/subagent'
export { queryViewTool, saveViewTool, sharedViewTools } from './tools/shared/views'

export const tools: AgentTool[] = [subagentTool, ...sharedViewTools]

const EMPTY_MEMORY_MD = '---\n---\n\n# Memory\n\n_empty_\n'

export interface AgentsMaterializerOpts {
  agentId: string
  agentDefinition: AgentDefinition
  commands: readonly CommandDef[]
}

export function buildAgentsMaterializers(opts: AgentsMaterializerOpts): WorkspaceMaterializer[] {
  const { agentId, agentDefinition, commands } = opts
  const agentsMdSource = generateAgentsMd({
    agentName: agentDefinition.name,
    agentId,
    commands,
    instructions: agentDefinition.instructions ?? '',
  })
  return [
    {
      path: `/agents/${agentId}/AGENTS.md`,
      phase: 'frozen',
      materialize: () => agentsMdSource,
    },
    {
      path: `/agents/${agentId}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => agentDefinition.workingMemory || EMPTY_MEMORY_MD,
    },
  ]
}

export { buildAgentsMaterializers as buildMaterializers }
