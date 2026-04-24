import { Agent } from '@mastra/core/agent'

import { getMemory } from '../index'
import { agentModel } from '../lib/provider'
import { resolveInputProcessors } from '../processors'

const WORKSPACE_INSTRUCTIONS = `You are a friendly, professional assistant. You operate via a workspace filesystem and CLI commands.

## Getting Started
Your workspace is at /workspace/. Run \`cat /workspace/AGENTS.md\` for the full command reference and workflow rules.
Run \`cat /workspace/SOUL.md\` for your business identity and brand voice.

## Quick Reference
- Read messages: \`cat /workspace/conversation/messages.md\`
- Read contact info: \`cat /workspace/contact/profile.md\`
- Read your notes: \`cat /workspace/contact/notes.md\`
- Reply to customer: \`vobase reply <message>\`
- Check slots: \`vobase check-slots <date> --service <s>\`
- Book: \`vobase book <datetime> --service <s>\`
- Resolve: \`vobase resolve\`

## Core Rules
1. ALWAYS read conversation/messages.md first to understand context.
2. ALWAYS use \`vobase reply\` to respond — the customer sees nothing without it.
3. Use \`vobase resolve\` when the interaction is complete.
4. Write observations to contact/notes.md with \`echo "- observation" >> /workspace/contact/notes.md\`.
5. When you see [Image] with no caption, use \`vobase analyze-media <messageId>\` to examine it.
`

const MAX_CACHE_SIZE = 50

const agentCache = new Map<string, { agent: Agent; model: string; updatedAt: Date }>()

/** Create or retrieve a cached Mastra Agent instance for a DB-defined agent. */
export function resolveAgent(def: { id: string; name: string; model: string; updatedAt: Date }): Agent {
  const cached = agentCache.get(def.id)
  if (cached && cached.model === def.model && cached.updatedAt >= def.updatedAt) {
    // Re-insert to refresh Map's iteration order — makes the below eviction LRU.
    agentCache.delete(def.id)
    agentCache.set(def.id, cached)
    return cached.agent
  }

  const agent = new Agent({
    id: def.id,
    name: def.name,
    instructions: WORKSPACE_INSTRUCTIONS,
    model: agentModel(def.model as `${string}/${string}`),
    tools: {},
    defaultOptions: { maxSteps: 20 },
    inputProcessors: resolveInputProcessors,
  })

  try {
    agent.__setMemory(getMemory())
  } catch {
    // Memory not initialized yet — will be set at wake time
  }

  agentCache.set(def.id, { agent, model: def.model, updatedAt: def.updatedAt })

  if (agentCache.size > MAX_CACHE_SIZE) {
    const oldest = agentCache.keys().next().value
    if (oldest) agentCache.delete(oldest)
  }

  return agent
}
