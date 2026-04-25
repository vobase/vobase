/**
 * Agents materializers — render `/agents/<id>/AGENTS.md` + MEMORY.md into the
 * virtual workspace.
 *
 * AGENTS.md is generated from the agent definition + registered commands via
 * `generateAgentsMd()` in core. MEMORY.md is the agent's working-memory blob
 * (falls back to the empty-memory stub).
 *
 * Called as a wake-time factory because the path encodes the agent id and the
 * content depends on the agent definition loaded at wake start.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import type { CommandDef, WorkspaceMaterializer } from '@vobase/core'
import { generateAgentsMd } from '@vobase/core'

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
