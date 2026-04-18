/**
 * REAL Phase 1 — reads from agents.agent_definitions.
 * Write methods are scaffold only (throw not-implemented-in-phase-1).
 */
import type { AgentDefinition } from '@server/contracts/domain-types'

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
