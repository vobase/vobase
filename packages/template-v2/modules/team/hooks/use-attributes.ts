/**
 * TanStack Query hooks for staff attribute definitions + per-staff values.
 * Clone of contacts/hooks/use-attributes.ts — the two namespaces evolve
 * independently.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { teamClient } from '@/lib/api-client'
import type { AttributeType, AttributeValue, StaffAttributeDefinition, StaffProfile } from '../schema'

export const attrKeys = {
  defs: ['team', 'attribute-definitions'] as const,
}

export function useAttributeDefinitions() {
  return useQuery({
    queryKey: attrKeys.defs,
    queryFn: async (): Promise<StaffAttributeDefinition[]> => {
      const r = await teamClient.attributes.$get()
      if (!r.ok) throw new Error(`attribute defs failed: ${r.status}`)
      return (await r.json()) as unknown as StaffAttributeDefinition[]
    },
  })
}

export interface CreateDefBody {
  key: string
  label: string
  type: AttributeType
  options?: string[]
  showInTable?: boolean
  sortOrder?: number
}

export function useCreateDefinition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateDefBody): Promise<StaffAttributeDefinition> => {
      const r = await teamClient.attributes.$post({ json: body })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(typeof err.error === 'string' ? err.error : `create def failed: ${r.status}`)
      }
      return (await r.json()) as unknown as StaffAttributeDefinition
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attrKeys.defs })
    },
  })
}

export interface UpdateDefBody {
  label?: string
  type?: AttributeType
  options?: string[]
  showInTable?: boolean
  sortOrder?: number
}

export function useUpdateDefinition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateDefBody }): Promise<StaffAttributeDefinition> => {
      const r = await teamClient.attributes[':id'].$patch({ param: { id }, json: patch })
      if (!r.ok) throw new Error(`update def failed: ${r.status}`)
      return (await r.json()) as unknown as StaffAttributeDefinition
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attrKeys.defs })
    },
  })
}

export function useDeleteDefinition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await teamClient.attributes[':id'].$delete({ param: { id } })
      if (!r.ok) throw new Error(`delete def failed: ${r.status}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attrKeys.defs })
    },
  })
}

export function useSetStaffAttributes(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (values: Record<string, AttributeValue>): Promise<StaffProfile> => {
      const r = await teamClient.staff[':userId'].attributes.$patch({ param: { userId }, json: { values } })
      if (!r.ok) throw new Error(`update staff attributes failed: ${r.status}`)
      return (await r.json()) as unknown as StaffProfile
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
    },
  })
}
