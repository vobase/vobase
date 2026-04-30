import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { agentsClient } from '@/lib/api-client'

export interface AgentDefinitionRow {
  id: string
  name: string
  model: string
  enabled: boolean
  updatedAt: string
}

export interface AgentDefinitionDetail extends AgentDefinitionRow {
  organizationId: string
  instructions: string
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
  instructions?: string
  workingMemory?: string
  enabled?: boolean
}

export interface UpdateAgentBody {
  name?: string
  model?: string
  instructions?: string
  workingMemory?: string
  enabled?: boolean
}

export function useAgentDefinitions() {
  return useQuery({
    queryKey: ['agents', 'definitions'],
    queryFn: async (): Promise<AgentDefinitionRow[]> => {
      const r = await agentsClient.definitions.$get()
      if (!r.ok) throw new Error(`agents.list failed: ${r.status}`)
      return (await r.json()) as unknown as AgentDefinitionRow[]
    },
  })
}

export function useAgentDefinition(id: string | undefined) {
  return useQuery({
    queryKey: ['agents', 'definitions', id],
    enabled: !!id,
    queryFn: async (): Promise<AgentDefinitionDetail> => {
      if (!id) throw new Error('id required')
      const r = await agentsClient.definitions[':id'].$get({ param: { id } })
      if (!r.ok) throw new Error(`agents.get failed: ${r.status}`)
      return (await r.json()) as unknown as AgentDefinitionDetail
    },
  })
}

export function useAgentsMd(id: string | undefined) {
  return useQuery({
    queryKey: ['agents', 'definitions', id, 'agents-md'],
    enabled: !!id,
    queryFn: async (): Promise<{ preamble: string }> => {
      if (!id) throw new Error('id required')
      const r = await agentsClient.definitions[':id']['agents-md'].$get({ param: { id } })
      if (!r.ok) throw new Error(`agents.agents-md failed: ${r.status}`)
      return (await r.json()) as unknown as { preamble: string }
    },
  })
}

export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateAgentBody) => {
      const r = await agentsClient.definitions.$post({ json: body })
      if (!r.ok) throw new Error(`POST /api/agents/definitions failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'definitions'] }),
  })
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateAgentBody) => {
      const r = await agentsClient.definitions[':id'].$patch({ param: { id }, json: body })
      if (!r.ok) throw new Error(`PATCH /api/agents/definitions/${id} failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', 'definitions'] })
      qc.invalidateQueries({ queryKey: ['agents', 'definitions', id] })
    },
  })
}

export function useDeleteAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await agentsClient.definitions[':id'].$delete({ param: { id } })
      if (!r.ok) throw new Error(`DELETE /api/agents/definitions/${id} failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'definitions'] }),
  })
}
