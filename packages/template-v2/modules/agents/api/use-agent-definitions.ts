import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface AgentDefinitionRow {
  id: string
  name: string
  model: string
  enabled: boolean
  updatedAt: string
}

export interface AgentDefinitionDetail extends AgentDefinitionRow {
  organizationId: string
  soulMd: string
  workingMemory: string
  maxSteps: number | null
  skillAllowlist: string[] | null
  cardApprovalRequired: boolean
  fileApprovalRequired: boolean
  bookSlotApprovalRequired: boolean
  createdAt: string
}

export interface CreateAgentBody {
  name: string
  model?: string
  soulMd?: string
  workingMemory?: string
  enabled?: boolean
}

export interface UpdateAgentBody {
  name?: string
  model?: string
  soulMd?: string
  workingMemory?: string
  enabled?: boolean
}

export function useAgentDefinitions() {
  return useQuery({
    queryKey: ['agents', 'definitions'],
    queryFn: async (): Promise<AgentDefinitionRow[]> => {
      const r = await fetch('/api/agents/definitions')
      if (!r.ok) throw new Error(`agents.list failed: ${r.status}`)
      return r.json()
    },
  })
}

export function useAgentDefinition(id: string | undefined) {
  return useQuery({
    queryKey: ['agents', 'definitions', id],
    enabled: !!id,
    queryFn: async (): Promise<AgentDefinitionDetail> => {
      const r = await fetch(`/api/agents/definitions/${id}`)
      if (!r.ok) throw new Error(`agents.get failed: ${r.status}`)
      return r.json()
    },
  })
}

async function jsonFetch(url: string, init: RequestInit): Promise<unknown> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${url} failed: ${r.status}`)
  return r.json()
}

export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAgentBody) =>
      jsonFetch('/api/agents/definitions', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'definitions'] }),
  })
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAgentBody) =>
      jsonFetch(`/api/agents/definitions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', 'definitions'] })
      qc.invalidateQueries({ queryKey: ['agents', 'definitions', id] })
    },
  })
}

export function useDeleteAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => jsonFetch(`/api/agents/definitions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'definitions'] }),
  })
}
