/**
 * TanStack Query hooks for staff profiles + attribute values.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
      const r = await fetch('/api/team/staff')
      if (!r.ok) throw new Error(`staff list failed: ${r.status}`)
      return (await r.json()) as StaffProfile[]
    },
  })
}

export function useStaff(userId: string) {
  return useQuery({
    queryKey: staffKeys.detail(userId),
    queryFn: async (): Promise<StaffProfile> => {
      const r = await fetch(`/api/team/staff/${encodeURIComponent(userId)}`)
      if (!r.ok) throw new Error(`staff get failed: ${r.status}`)
      return (await r.json()) as StaffProfile
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
  assignmentNotes?: string
}

export function useUpsertStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpsertStaffBody): Promise<StaffProfile> => {
      const r = await fetch('/api/team/staff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(typeof err.error === 'string' ? err.error : `upsert failed: ${r.status}`)
      }
      return (await r.json()) as StaffProfile
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
      const r = await fetch(`/api/team/staff/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error(`update failed: ${r.status}`)
      return (await r.json()) as StaffProfile
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
      const r = await fetch(`/api/team/staff/${encodeURIComponent(userId)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`remove failed: ${r.status}`)
    },
    onSuccess: (_, userId) => {
      qc.invalidateQueries({ queryKey: staffKeys.list })
      qc.invalidateQueries({ queryKey: staffKeys.detail(userId) })
    },
  })
}
