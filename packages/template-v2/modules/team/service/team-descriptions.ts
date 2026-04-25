/**
 * Team descriptions service — CRUD for `team.team_descriptions`.
 *
 * Team identity (name, membership) lives in better-auth (`auth.team` +
 * `auth.team_member`); this table only stores the free-text description
 * surfaced to routing agents.
 */

import { teamDescriptions } from '@modules/team/schema'
import { eq } from 'drizzle-orm'

import type { TeamDescription } from '../schema'

export interface TeamDescriptionService {
  list(organizationId: string): Promise<TeamDescription[]>
  get(teamId: string): Promise<TeamDescription | null>
  upsert(input: { teamId: string; organizationId: string; description: string }): Promise<TeamDescription>
  remove(teamId: string): Promise<void>
}

interface Deps {
  db: unknown
}

export function createTeamDescriptionService(deps: Deps): TeamDescriptionService {
  const db = deps.db as { select: Function; insert: Function; update: Function; delete: Function }

  async function list(organizationId: string): Promise<TeamDescription[]> {
    const rows = (await db
      .select()
      .from(teamDescriptions)
      .where(eq(teamDescriptions.organizationId, organizationId))) as unknown[]
    return rows as TeamDescription[]
  }

  async function get(teamId: string): Promise<TeamDescription | null> {
    const rows = (await db
      .select()
      .from(teamDescriptions)
      .where(eq(teamDescriptions.teamId, teamId))
      .limit(1)) as unknown[]
    return (rows[0] as TeamDescription | undefined) ?? null
  }

  async function upsert(input: {
    teamId: string
    organizationId: string
    description: string
  }): Promise<TeamDescription> {
    const rows = (await db
      .insert(teamDescriptions)
      .values(input)
      .onConflictDoUpdate({
        target: teamDescriptions.teamId,
        set: { description: input.description, organizationId: input.organizationId },
      })
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error('team-descriptions/upsert: insert returned no rows')
    return row as TeamDescription
  }

  async function remove(teamId: string): Promise<void> {
    await db.delete(teamDescriptions).where(eq(teamDescriptions.teamId, teamId))
  }

  return { list, get, upsert, remove }
}

let _current: TeamDescriptionService | null = null

export function installTeamDescriptionService(svc: TeamDescriptionService): void {
  _current = svc
}

export function __resetTeamDescriptionServiceForTests(): void {
  _current = null
}

function currentSvc(): TeamDescriptionService {
  if (!_current) throw new Error('team/team-descriptions: service not installed')
  return _current
}

export function listDescriptions(organizationId: string): Promise<TeamDescription[]> {
  return currentSvc().list(organizationId)
}
export function getDescription(teamId: string): Promise<TeamDescription | null> {
  return currentSvc().get(teamId)
}
export function upsertDescription(input: {
  teamId: string
  organizationId: string
  description: string
}): Promise<TeamDescription> {
  return currentSvc().upsert(input)
}
export function removeDescription(teamId: string): Promise<void> {
  return currentSvc().remove(teamId)
}
