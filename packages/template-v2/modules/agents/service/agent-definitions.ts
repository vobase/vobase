/**
 * REAL Phase 1 — reads from agents.agent_definitions.
 * Write methods are scaffold only (throw not-implemented-in-phase-1).
 *
 * `BUILTIN_TOOL_NAMES` exposes the first-class tool slots the harness always
 * surfaces — `bash` (virtual-workspace shell, see `server/harness/bash-tool.ts`)
 * and `vobase` (skill-registered CLI dispatcher, see
 * `server/workspace/vobase-cli/dispatcher.ts`). SOUL.md's tools-allowlist stays
 * declarative: any tool whose name is in this constant is considered available to
 * the agent without requiring an explicit entry in the per-agent `skillAllowlist`
 * column.
 */
import type { AgentDefinition } from '@server/contracts/domain-types'

export const BUILTIN_TOOL_NAMES = ['bash', 'vobase'] as const
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number]

/**
 * Returns the effective allowlist for a loaded agent definition — union of the
 * per-agent `skillAllowlist` and the always-on built-ins. Order is stable:
 * built-ins first, then the per-agent entries in declaration order (dedup).
 */
export function resolveAllowedTools(def: Pick<AgentDefinition, 'skillAllowlist'>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of BUILTIN_TOOL_NAMES) {
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  for (const name of def.skillAllowlist ?? []) {
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb(): unknown {
  if (!_db) throw new Error('agents/agent-definitions: db not initialised — call setDb() in module init')
  return _db
}

export async function getById(id: string): Promise<AgentDefinition> {
  const { agentDefinitions } = await import('@modules/agents/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const rows = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1)

  const row = rows[0]
  if (!row) throw new Error(`agent definition not found: ${id}`)
  return row as AgentDefinition
}

// Scaffold — Phase 2
export async function create(_input: unknown): Promise<AgentDefinition> {
  throw new Error('not-implemented-in-phase-1: agents/agent-definitions.create')
}

export async function update(_id: string, _input: unknown): Promise<AgentDefinition> {
  throw new Error('not-implemented-in-phase-1: agents/agent-definitions.update')
}

export async function remove(_id: string): Promise<void> {
  throw new Error('not-implemented-in-phase-1: agents/agent-definitions.remove')
}

export async function list(_tenantId: string): Promise<AgentDefinition[]> {
  throw new Error('not-implemented-in-phase-1: agents/agent-definitions.list')
}

/**
 * Returns the working memory for the agent assigned to a conversation.
 * Returns null if the conversation is not found or belongs to a different tenant (404 signal).
 * Returns `{ memory: null }` if the conversation has no agent assigned or the agent has no memory.
 */
export async function getConversationWorkingMemory(
  conversationId: string,
  requestingTenantId: string,
): Promise<{ memory: string | null } | null> {
  const { conversations } = await import('@modules/inbox/schema')
  const { agentDefinitions } = await import('@modules/agents/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }

  const convRows = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  const conv = convRows[0] as { tenantId: string; assignee: string } | undefined
  if (!conv || conv.tenantId !== requestingTenantId) return null

  const agentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice(6) : null
  if (!agentId) return { memory: null }

  const agentRows = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, agentId)).limit(1)
  const agent = agentRows[0] as { workingMemory: string } | undefined
  if (!agent) return { memory: null }

  return { memory: agent.workingMemory || null }
}
