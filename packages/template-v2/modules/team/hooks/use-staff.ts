/**
 * TanStack Query hooks for staff profiles + attribute values.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { teamClient } from '@/lib/api-client'
import type { Availability, StaffProfile } from '../schema'

export const staffKeys = {
  all: ['staff'] as const,
  list: ['staff', 'list'] as const,
  detail: (userId: string) => ['staff', 'detail', userId] as const,
}

export function useStaffList() {
  return useQuery({
    queryKey: staffKeys.list,
    queryFn: async (): Promise<StaffProfile[]> => {
      const r = await teamClient.staff.$get()
      if (!r.ok) throw new Error(`staff list failed: ${r.status}`)
      return (await r.json()) as unknown as StaffProfile[]
    },
  })
}

export function useStaff(userId: string) {
  return useQuery({
    queryKey: staffKeys.detail(userId),
    queryFn: async (): Promise<StaffProfile> => {
      const r = await teamClient.staff[':userId'].$get({ param: { userId } })
      if (!r.ok) throw new Error(`staff get failed: ${r.status}`)
      return (await r.json()) as unknown as StaffProfile
    },
    enabled: Boolean(userId),
  })
}

export interface UpsertStaffBody {
  userId: string
  displayName?: string | null
  title?: string | null
  sectors?: string[]
  expertise?: string[]
  languages?: string[]
  capacity?: number
  availability?: Availability
  profile?: string
  notes?: string
}

export function useUpsertStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpsertStaffBody): Promise<StaffProfile> => {
      const r = await teamClient.staff.$post({ json: body })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(typeof err.error === 'string' ? err.error : `upsert failed: ${r.status}`)
      }
      return (await r.json()) as unknown as StaffProfile
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: staffKeys.list })
      qc.invalidateQueries({ queryKey: staffKeys.detail(row.userId) })
    },
  })
}

export type UpdateStaffBody = Omit<UpsertStaffBody, 'userId'>

export function useUpdateStaff(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: UpdateStaffBody): Promise<StaffProfile> => {
      const r = await teamClient.staff[':userId'].$patch({ param: { userId }, json: patch })
      if (!r.ok) throw new Error(`update failed: ${r.status}`)
      return (await r.json()) as unknown as StaffProfile
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffKeys.list })
      qc.invalidateQueries({ queryKey: staffKeys.detail(userId) })
    },
  })
}

export function useRemoveStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string): Promise<void> => {
      const r = await teamClient.staff[':userId'].$delete({ param: { userId } })
      if (!r.ok) throw new Error(`remove failed: ${r.status}`)
    },
    onSuccess: (_, userId) => {
      qc.invalidateQueries({ queryKey: staffKeys.list })
      qc.invalidateQueries({ queryKey: staffKeys.detail(userId) })
    },
  })
}
