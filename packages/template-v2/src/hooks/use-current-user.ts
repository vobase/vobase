import { authClient } from '@/lib/auth-client'

export function useCurrentUserId(): string | null {
  const res = authClient.useSession() as unknown as { data?: { user?: { id?: string } | null } | null } | null
  return res?.data?.user?.id ?? null
}
