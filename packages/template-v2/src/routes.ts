import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { ApprovalsPage } from './pages/approvals'
import { ConversationPage } from './pages/conversation.$id'
import { InboxPage } from './pages/inbox'
import { AppShell } from './root'

const rootRoute = createRootRoute({ component: AppShell })

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: InboxPage,
})

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversation/$id',
  component: ConversationPage,
})

const approvalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/approvals',
  component: ApprovalsPage,
})

const routeTree = rootRoute.addChildren([inboxRoute, conversationRoute, approvalsRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
