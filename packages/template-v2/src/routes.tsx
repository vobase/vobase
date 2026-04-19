import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from './components/layout/app-shell'
import { useRealtimeInvalidation } from './hooks/use-realtime-invalidation'
import { ApprovalsPage } from './pages/approvals'
import { ConversationDetailPlaceholder, InboxEmptyState, InboxLayout } from './pages/inbox'

function RootLayout() {
  useRealtimeInvalidation()
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

const rootRoute = createRootRoute({ component: RootLayout })

const rootIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/inbox' })
  },
})

const inboxParentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxLayout,
})

const inboxIndexRoute = createRoute({
  getParentRoute: () => inboxParentRoute,
  path: '/',
  component: InboxEmptyState,
})

export const inboxDetailRoute = createRoute({
  getParentRoute: () => inboxParentRoute,
  path: '$id',
  component: ConversationDetailPlaceholder,
})

const approvalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/approvals',
  component: ApprovalsPage,
})

const routeTree = rootRoute.addChildren([
  rootIndexRoute,
  inboxParentRoute.addChildren([inboxIndexRoute, inboxDetailRoute]),
  approvalsRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
