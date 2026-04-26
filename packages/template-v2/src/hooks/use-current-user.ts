import { authClient } from '@/lib/auth-client'

export function useCurrentUserId(): string | null {
  const res = authClient.useSession() as unknown as { data?: { user?: { id?: string } | null } | null } | null
  return res?.data?.user?.id ?? null
}

export function useActiveOrganizationId(): string | null {
  const res = authClient.useSession() as unknown as {
    data?: { session?: { activeOrganizationId?: string | null } | null } | null
  } | null
  return res?.data?.session?.activeOrganizationId ?? null
}
