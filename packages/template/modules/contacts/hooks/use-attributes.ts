/**
 * TanStack Query hooks for contact attribute definitions + per-contact values.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { contactsClient } from '@/lib/api-client'
import type { AttributeType, AttributeValue, Contact, ContactAttributeDefinition } from '../schema'

export const attrKeys = {
  defs: ['contacts', 'attribute-definitions'] as const,
}

export function useAttributeDefinitions() {
  return useQuery({
    queryKey: attrKeys.defs,
    queryFn: async (): Promise<ContactAttributeDefinition[]> => {
      const r = await contactsClient.definitions.$get()
      if (!r.ok) throw new Error(`attribute defs failed: ${r.status}`)
      return (await r.json()) as unknown as ContactAttributeDefinition[]
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
    mutationFn: async (body: CreateDefBody): Promise<ContactAttributeDefinition> => {
      const r = await contactsClient.definitions.$post({ json: body })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(typeof err.error === 'string' ? err.error : `create def failed: ${r.status}`)
      }
      return (await r.json()) as unknown as ContactAttributeDefinition
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
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateDefBody }): Promise<ContactAttributeDefinition> => {
      const r = await contactsClient.definitions[':id'].$patch({ param: { id }, json: patch })
      if (!r.ok) throw new Error(`update def failed: ${r.status}`)
      return (await r.json()) as unknown as ContactAttributeDefinition
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
      const r = await contactsClient.definitions[':id'].$delete({ param: { id } })
      if (!r.ok) throw new Error(`delete def failed: ${r.status}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attrKeys.defs })
    },
  })
}

export function useSetContactAttributes(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (values: Record<string, AttributeValue>): Promise<Contact> => {
      const r = await contactsClient[':contactId'].attributes.$patch({ param: { contactId }, json: { values } })
      if (!r.ok) throw new Error(`update contact attributes failed: ${r.status}`)
      return (await r.json()) as unknown as Contact
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}
