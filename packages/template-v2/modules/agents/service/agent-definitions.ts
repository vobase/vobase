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
 *
 * Factory-DI service. `createAgentDefinitionsService({ db })` returns the
 * bound API; `installAgentDefinitionsService(svc)` wires the module-scoped handle
 * used by the free-function wrappers. `setDb(db)` remains as a compatibility shim.
 */
import type { AgentDefinition } from '../schema'

export const BUILTIN_TOOL_NAMES = ['bash', 'vobase'] as const
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number]

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

export interface AgentDefinitionsService {
  getById(id: string): Promise<AgentDefinition>
  create(input: unknown): Promise<AgentDefinition>
  update(id: string, input: unknown): Promise<AgentDefinition>
  remove(id: string): Promise<void>
  list(organizationId: string): Promise<AgentDefinition[]>
  getConversationWorkingMemory(
    conversationId: string,
    requestingOrganizationId: string,
  ): Promise<{ memory: string | null } | null>
}

export interface AgentDefinitionsServiceDeps {
  db: unknown
}

export function createAgentDefinitionsService(deps: AgentDefinitionsServiceDeps): AgentDefinitionsService {
  const db = deps.db as { select: Function }

  async function getById(id: string): Promise<AgentDefinition> {
    const { agentDefinitions } = await import('@modules/agents/schema')
    const { eq } = await import('drizzle-orm')
    const rows = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1)
    const row = rows[0]
    if (!row) throw new Error(`agent definition not found: ${id}`)
    return row as AgentDefinition
  }

  async function create(_input: unknown): Promise<AgentDefinition> {
    throw new Error('not-implemented-in-phase-1: agents/agent-definitions.create')
  }

  async function update(_id: string, _input: unknown): Promise<AgentDefinition> {
    throw new Error('not-implemented-in-phase-1: agents/agent-definitions.update')
  }

  async function remove(_id: string): Promise<void> {
    throw new Error('not-implemented-in-phase-1: agents/agent-definitions.remove')
  }

  async function list(organizationId: string): Promise<AgentDefinition[]> {
    const { agentDefinitions } = await import('@modules/agents/schema')
    const { asc, eq } = await import('drizzle-orm')
    const rows = await db
      .select()
      .from(agentDefinitions)
      .where(eq(agentDefinitions.organizationId, organizationId))
      .orderBy(asc(agentDefinitions.name))
    return rows as AgentDefinition[]
  }

  async function getConversationWorkingMemory(
    conversationId: string,
    requestingOrganizationId: string,
  ): Promise<{ memory: string | null } | null> {
    const { conversations } = await import('@modules/inbox/schema')
    const { agentDefinitions } = await import('@modules/agents/schema')
    const { eq } = await import('drizzle-orm')

    const convRows = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
    const conv = convRows[0] as { organizationId: string; assignee: string } | undefined
    if (!conv || conv.organizationId !== requestingOrganizationId) return null

    const agentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice(6) : null
    if (!agentId) return { memory: null }

    const agentRows = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, agentId)).limit(1)
    const agent = agentRows[0] as { workingMemory: string } | undefined
    if (!agent) return { memory: null }

    return { memory: agent.workingMemory || null }
  }

  return { getById, create, update, remove, list, getConversationWorkingMemory }
}

let _currentAgentDefsService: AgentDefinitionsService | null = null

export function installAgentDefinitionsService(svc: AgentDefinitionsService): void {
  _currentAgentDefsService = svc
}

export function __resetAgentDefinitionsServiceForTests(): void {
  _currentAgentDefsService = null
}

function current(): AgentDefinitionsService {
  if (!_currentAgentDefsService) {
    throw new Error(
      'agents/agent-definitions: service not installed — call installAgentDefinitionsService() in module init',
    )
  }
  return _currentAgentDefsService
}

/** Compatibility shim — constructs + installs in one call. */
export function setDb(db: unknown): void {
  installAgentDefinitionsService(createAgentDefinitionsService({ db }))
}

export async function getById(id: string): Promise<AgentDefinition> {
  return current().getById(id)
}

export async function create(input: unknown): Promise<AgentDefinition> {
  return current().create(input)
}

export async function update(id: string, input: unknown): Promise<AgentDefinition> {
  return current().update(id, input)
}

export async function remove(id: string): Promise<void> {
  return current().remove(id)
}

export async function list(organizationId: string): Promise<AgentDefinition[]> {
  return current().list(organizationId)
}

export async function getConversationWorkingMemory(
  conversationId: string,
  requestingOrganizationId: string,
): Promise<{ memory: string | null } | null> {
  return current().getConversationWorkingMemory(conversationId, requestingOrganizationId)
}
