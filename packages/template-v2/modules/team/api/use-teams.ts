/**
 * TanStack Query hooks for better-auth teams CRUD + `team_descriptions`.
 *
 * Teams themselves (name, membership) live in better-auth — mutations use
 * `authClient.organization.*`. Descriptions are a template-v2 table exposed at
 * `/api/team/descriptions`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth-client'
import type { TeamDescription } from '../schema'

export interface TeamRow {
  id: string
  name: string
  organizationId: string
  createdAt: string | Date
  updatedAt?: string | Date
}

export interface TeamMemberRow {
  id: string
  teamId: string
  userId: string
  createdAt: string | Date
}

export interface OrgMemberRow {
  id: string
  userId: string
  organizationId: string
  role: string
  createdAt: string | Date
  user: { id: string; email: string; name?: string | null }
}

export const teamsKeys = {
  all: ['teams'] as const,
  list: ['teams', 'list'] as const,
  members: (teamId: string) => ['teams', 'members', teamId] as const,
  orgMembers: ['teams', 'org-members'] as const,
  descriptions: ['teams', 'descriptions'] as const,
  description: (teamId: string) => ['teams', 'descriptions', teamId] as const,
}

// biome-ignore lint/suspicious/noExplicitAny: better-auth runtime types are loose; we normalize to TeamRow
const client = authClient.organization as any

export function useTeams() {
  return useQuery({
    queryKey: teamsKeys.list,
    queryFn: async (): Promise<TeamRow[]> => {
      const { data, error } = await client.listOrganizationTeams({ query: {} })
      if (error) throw new Error(error.message ?? 'listOrganizationTeams failed')
      return (data ?? []) as TeamRow[]
    },
  })
}

export function useTeamMembers(teamId: string | null) {
  return useQuery({
    queryKey: teamsKeys.members(teamId ?? ''),
    queryFn: async (): Promise<TeamMemberRow[]> => {
      if (!teamId) return []
      const { data, error } = await client.listTeamMembers({ query: { teamId } })
      if (error) throw new Error(error.message ?? 'listTeamMembers failed')
      return (data ?? []) as TeamMemberRow[]
    },
    enabled: Boolean(teamId),
  })
}

export function useOrgMembers() {
  return useQuery({
    queryKey: teamsKeys.orgMembers,
    queryFn: async (): Promise<OrgMemberRow[]> => {
      const { data, error } = await client.listMembers({ query: {} })
      if (error) throw new Error(error.message ?? 'listMembers failed')
      const rows = Array.isArray(data) ? data : ((data as { members?: unknown[] })?.members ?? [])
      return rows as OrgMemberRow[]
    },
  })
}

export function useCreateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string }): Promise<TeamRow> => {
      const { data, error } = await client.createTeam({ name: input.name })
      if (error) throw new Error(error.message ?? 'createTeam failed')
      return data as TeamRow
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKeys.list }),
  })
}

export function useUpdateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { teamId: string; name: string }): Promise<TeamRow | null> => {
      const { data, error } = await client.updateTeam({ teamId: input.teamId, data: { name: input.name } })
      if (error) throw new Error(error.message ?? 'updateTeam failed')
      return (data ?? null) as TeamRow | null
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKeys.list }),
  })
}

export function useRemoveTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (teamId: string): Promise<void> => {
      const { error } = await client.removeTeam({ teamId })
      if (error) throw new Error(error.message ?? 'removeTeam failed')
    },
    onSuccess: (_, teamId) => {
      qc.invalidateQueries({ queryKey: teamsKeys.list })
      qc.invalidateQueries({ queryKey: teamsKeys.members(teamId) })
      qc.invalidateQueries({ queryKey: teamsKeys.description(teamId) })
    },
  })
}

export function useAddTeamMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { teamId: string; userId: string }): Promise<void> => {
      const { error } = await client.addTeamMember({ teamId: input.teamId, userId: input.userId })
      if (error) throw new Error(error.message ?? 'addTeamMember failed')
    },
    onSuccess: (_, { teamId }) => qc.invalidateQueries({ queryKey: teamsKeys.members(teamId) }),
  })
}

export function useRemoveTeamMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { teamId: string; userId: string }): Promise<void> => {
      const { error } = await client.removeTeamMember({ teamId: input.teamId, userId: input.userId })
      if (error) throw new Error(error.message ?? 'removeTeamMember failed')
    },
    onSuccess: (_, { teamId }) => qc.invalidateQueries({ queryKey: teamsKeys.members(teamId) }),
  })
}

export function useTeamDescriptions() {
  return useQuery({
    queryKey: teamsKeys.descriptions,
    queryFn: async (): Promise<TeamDescription[]> => {
      const r = await fetch('/api/team/descriptions')
      if (!r.ok) throw new Error(`descriptions list failed: ${r.status}`)
      return (await r.json()) as TeamDescription[]
    },
  })
}

export function useUpsertTeamDescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { teamId: string; description: string }): Promise<TeamDescription> => {
      const r = await fetch(`/api/team/descriptions/${encodeURIComponent(input.teamId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: input.description }),
      })
      if (!r.ok) throw new Error(`description upsert failed: ${r.status}`)
      return (await r.json()) as TeamDescription
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: teamsKeys.descriptions })
      qc.invalidateQueries({ queryKey: teamsKeys.description(row.teamId) })
    },
  })
}
