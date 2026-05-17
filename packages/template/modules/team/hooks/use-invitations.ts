/**
 * TanStack Query hooks for the pending-invitation surface.
 *
 * Query-key first element is `'auth_invitation'` so that `pg_notify({table:
 * 'auth_invitation'})` from `service/invitations.ts` invalidates this cache
 * (see `src/hooks/use-realtime-invalidation.ts` fallback branch).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { teamClient } from '@/lib/api-client'

export const invitationsKeys = {
  all: ['auth_invitation'] as const,
  list: ['auth_invitation', 'list'] as const,
}

export interface PendingInvitationRow {
  id: string
  email: string
  role: string | null
  phoneNumber: string | null
  inviterId: string
  inviterName: string | null
  inviterEmail: string | null
  /** ISO-8601 string — the wire format Hono serializes Date columns to. */
  expiresAt: string
  createdAt: string
}

export function usePendingInvitations() {
  return useQuery({
    queryKey: invitationsKeys.list,
    queryFn: async (): Promise<PendingInvitationRow[]> => {
      const r = await teamClient.invitations.$get()
      if (!r.ok) throw new Error(`invitations list failed: ${r.status}`)
      return (await r.json()) as unknown as PendingInvitationRow[]
    },
  })
}

export function useResendInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string): Promise<void> => {
      const r = await teamClient.invitations[':id'].resend.$post({ param: { id: invitationId } })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        const msg = typeof err.message === 'string' ? err.message : (err.error ?? `resend failed: ${r.status}`)
        throw new Error(msg)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitationsKeys.list })
    },
  })
}

export function useRevokeInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string): Promise<void> => {
      const r = await teamClient.invitations[':id'].$delete({ param: { id: invitationId } })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        const msg = typeof err.message === 'string' ? err.message : (err.error ?? `revoke failed: ${r.status}`)
        throw new Error(msg)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitationsKeys.list })
    },
  })
}
