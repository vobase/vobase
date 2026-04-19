import { createRootRoute, createRoute, createRouter, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { AppShell } from './components/layout/app-shell'
import { useRealtimeInvalidation } from './hooks/use-realtime-invalidation'
import { ApprovalsPage } from './pages/approvals'
import { ConversationDetailPlaceholder, InboxEmptyState, InboxLayout } from './pages/inbox'
import { TestWebPage } from './pages/test-web'

// Vite replaces import.meta.env.DEV with a boolean literal at build time, so the
// branch and its import are dead-code-eliminated from production bundles.
const IS_DEV = import.meta.env.DEV

function RootLayout() {
  useRealtimeInvalidation()
  // /test-web is a customer-facing chat widget; it renders without the staff AppShell chrome.
  const isStandalone = useRouterState({ select: (s) => s.location.pathname.startsWith('/test-web') })
  if (isStandalone) return <Outlet />
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

// In prod builds Vite replaces `import.meta.env.DEV` with `false`, so the ternary
// collapses to `null` and Rollup tree-shakes the TestWebPage import out of the
// bundle (test-web.tsx has no module-scope side effects).
const testWebRoute = IS_DEV
  ? createRoute({
      getParentRoute: () => rootRoute,
      path: '/test-web',
      component: TestWebPage,
    })
  : null

const routeTree = rootRoute.addChildren([
  rootIndexRoute,
  inboxParentRoute.addChildren([inboxIndexRoute, inboxDetailRoute]),
  approvalsRoute,
  ...(testWebRoute ? [testWebRoute] : []),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
