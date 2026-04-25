/**
 * Agent-facing surfaces for the agents module.
 *
 * `tools` is the static subagent tool (surfaced via `collectAgentContributions`).
 *
 * Listeners and materializers are per-wake factories — they close over wake-time
 * state (`fs`, `tracker`, `agentDefinition`, `contactId`) that the collector
 * cannot know at boot. Wake handler composes them alongside the static bundle.
 */

import type { AgentTool } from '@vobase/core'

import { subagentTool } from './tools/subagent'

export { buildAgentsMaterializers as buildMaterializers } from './materializers'
export { createMemoryDistillListener } from './observers/memory-distill'
export { sseListener } from './observers/sse'
export { createWorkspaceSyncListener } from './observers/workspace-sync'
export { subagentTool } from './tools/subagent'

export const tools: AgentTool[] = [subagentTool]
