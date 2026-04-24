import { useQuery } from '@tanstack/react-query'

import { authClient } from '@/lib/auth-client'

export interface ActiveMemberRow {
  id: string
  userId: string
  organizationId: string
  role: string
}

/**
 * Returns the signed-in user's membership in the active organization, or null
 * if they have no active org / no membership. Used to gate owner/admin-only UI
 * (e.g. "Invite member" button in `/team`).
 */
export function useActiveMember() {
  return useQuery({
    queryKey: ['org', 'active-member'],
    queryFn: async (): Promise<ActiveMemberRow | null> => {
      // biome-ignore lint/suspicious/noExplicitAny: better-auth runtime types are loose
      const { data, error } = await (authClient.organization as any).getActiveMember()
      if (error) {
        // Treat "no active member" as null rather than throwing — callers
        // render an empty state instead of an error.
        return null
      }
      return (data ?? null) as ActiveMemberRow | null
    },
  })
}

export function canInviteMembers(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
