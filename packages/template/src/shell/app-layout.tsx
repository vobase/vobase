import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { AppShell } from '@/components/layout/app-shell'
import { useRealtimeInvalidation } from '@/hooks/use-realtime-invalidation'
import { authClient } from '@/lib/auth-client'

async function requireSession() {
  const res = await authClient.getSession()
  const session = (res as { data?: { session?: unknown } | null } | null)?.data?.session
  if (!session) {
    throw redirect({ to: '/auth/login' })
  }
}

function AppLayout() {
  useRealtimeInvalidation()
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

export const Route = createFileRoute('/_app')({
  beforeLoad: requireSession,
  component: AppLayout,
})
