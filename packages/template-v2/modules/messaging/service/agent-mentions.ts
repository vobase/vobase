/**
 * Agent-mention resolver for staff-authored notes.
 *
 * Scans an `addNote` body for `@AgentName` tokens, resolves each to the
 * matching `agent_definitions` row in the same organization (enabled only),
 * and returns the deduplicated set of agent ids. When the composer passes
 * its own `mentions[]` list (entries shaped as `agent:<id>` or `staff:<id>`),
 * the result is intersected with the agent-typed entries so a stale name in
 * the body cannot wake an agent the user did not actually mention.
 *
 * Word-boundary + longest-name precedence rules mirror the frontend scanner
 * in `modules/messaging/components/mentions.ts`. Case-insensitive.
 *
 * **HARD RULE — staff-authored only.** This resolver MUST NOT be invoked for
 * agent-authored notes. The supervisor fan-out path in `notes.ts::addNote`
 * checks `input.author.kind !== 'agent'` before calling in. Routing an agent
 * note through here would re-fire wakes on every `@-mention` an agent writes,
 * yielding a ping-pong loop (see the trigger-driven-capabilities plan,
 * Risk #1).
 */

import { agentDefinitions } from '@modules/agents/schema'
import { and, eq } from 'drizzle-orm'

interface AgentRow {
  id: string
  name: string
}

interface ResolverDb {
  select: (fields?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => Promise<AgentRow[]>
    }
  }
}

export interface AgentMentionsService {
  resolveAgentMentionsInBody(opts: { body: string; organizationId: string; mentions?: string[] }): Promise<string[]>
}

export interface AgentMentionsServiceDeps {
  db: unknown
}

export function createAgentMentionsService(deps: AgentMentionsServiceDeps): AgentMentionsService {
  const db = deps.db as ResolverDb

  async function resolveAgentMentionsInBody(opts: {
    body: string
    organizationId: string
    mentions?: string[]
  }): Promise<string[]> {
    const { body, organizationId, mentions } = opts
    if (!body || body.length === 0) return []
    // No `@` in the body → no agent mention can match. Skip the DB round-trip
    // for the common case of staff notes without any mentions.
    if (body.indexOf('@') === -1) return []

    // Composer mentions[] intersection: only agent-typed entries are kept,
    // stripped of the `agent:` prefix. When mentions is undefined or empty,
    // all body matches survive.
    const composerAgentIds: Set<string> | null = (() => {
      if (!mentions || mentions.length === 0) return null
      const set = new Set<string>()
      for (const m of mentions) {
        if (typeof m !== 'string') continue
        if (m.startsWith('agent:')) set.add(m.slice('agent:'.length))
      }
      return set
    })()

    if (composerAgentIds && composerAgentIds.size === 0) {
      // Composer explicitly mentioned someone, but no agents — short-circuit.
      return []
    }

    let rows: AgentRow[]
    try {
      rows = await db
        .select({ id: agentDefinitions.id, name: agentDefinitions.name })
        .from(agentDefinitions)
        .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.enabled, true)))
    } catch (err) {
      // Resolver MUST NOT throw on DB errors — fan-out is best-effort.
      console.error('[messaging/agent-mentions] db query failed:', err)
      return []
    }

    if (rows.length === 0) return []

    // Build matcher: longest @name first so `@Sentinelbot` shadows `@Sentinel`
    // when both exist.
    const candidates = rows
      .map((r) => ({ id: r.id, lc: `@${r.name}`.toLowerCase() }))
      .sort((a, b) => b.lc.length - a.lc.length)

    const lower = body.toLowerCase()
    const matched = new Set<string>()
    let i = 0
    while (i < body.length) {
      if (body[i] !== '@') {
        i++
        continue
      }
      let consumed = 0
      for (const c of candidates) {
        if (!lower.startsWith(c.lc, i)) continue
        const next = body[i + c.lc.length]
        if (next !== undefined && /[A-Za-z0-9._-]/.test(next)) continue
        matched.add(c.id)
        consumed = c.lc.length
        break
      }
      i += consumed > 0 ? consumed : 1
    }

    if (matched.size === 0) return []

    // Intersect with composer mentions[] when provided.
    if (composerAgentIds) {
      const out: string[] = []
      for (const id of matched) {
        if (composerAgentIds.has(id)) out.push(id)
      }
      return out
    }

    return [...matched]
  }

  return { resolveAgentMentionsInBody }
}

let _currentAgentMentionsService: AgentMentionsService | null = null

export function installAgentMentionsService(svc: AgentMentionsService): void {
  _currentAgentMentionsService = svc
}

export function __resetAgentMentionsServiceForTests(): void {
  _currentAgentMentionsService = null
}

function current(): AgentMentionsService {
  if (!_currentAgentMentionsService) {
    throw new Error(
      'messaging/agent-mentions: service not installed — call installAgentMentionsService() in module init',
    )
  }
  return _currentAgentMentionsService
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function resolveAgentMentionsInBody(opts: {
  body: string
  organizationId: string
  mentions?: string[]
}): Promise<string[]> {
  return current().resolveAgentMentionsInBody(opts)
}
