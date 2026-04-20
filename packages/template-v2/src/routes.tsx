import { createRootRoute, createRoute, createRouter, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { AppShell } from './components/layout/app-shell'
import { Toaster } from './components/ui/sonner'
import { useRealtimeInvalidation } from './hooks/use-realtime-invalidation'
import { authClient } from './lib/auth-client'
import { AgentsLearningsPage } from './pages/agents/learnings'
import { AgentsListPage } from './pages/agents/list'
import { ApprovalsPage } from './pages/approvals'
import { AuthLayout } from './pages/auth/layout'
import LoginPage from './pages/auth/login'
import PendingPage from './pages/auth/pending'
import { ChannelsPage } from './pages/channels'
import { ContactDetailPage } from './pages/contacts/detail'
import { ContactsListPage } from './pages/contacts/list'
import { DrivePage } from './pages/drive'
import GeneralErrorPage from './pages/errors/general-error'
import NotFoundPage from './pages/errors/not-found'
import { ConversationDetailPlaceholder, InboxEmptyState, InboxLayout } from './pages/inbox'
import AccountPage from './pages/settings/account'
import ApiKeysPage from './pages/settings/api-keys'
import AppearancePage from './pages/settings/appearance'
import DisplayPage from './pages/settings/display'
import SettingsLayout from './pages/settings/layout'
import NotificationsPage from './pages/settings/notifications'
import ProfilePage from './pages/settings/profile'
import { TestWebPage } from './pages/test-web'

async function requireSession() {
  const res = await authClient.getSession()
  const session = (res as { data?: { session?: unknown } | null } | null)?.data?.session
  if (!session) {
    throw redirect({ to: '/auth/login' })
  }
}

const IS_DEV = import.meta.env.DEV

function RootLayout() {
  useRealtimeInvalidation()
  const isStandalone = useRouterState({
    select: (s) => {
      const p = s.location.pathname
      return p.startsWith('/test-web') || p.startsWith('/auth/')
    },
  })
  return (
    <>
      {isStandalone ? <Outlet /> : <AppShell><Outlet /></AppShell>}
      <Toaster richColors closeButton />
    </>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: GeneralErrorPage,
})

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
  beforeLoad: requireSession,
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
  beforeLoad: requireSession,
})

// Contacts
const contactsParentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contacts',
  beforeLoad: requireSession,
})
const contactsIndexRoute = createRoute({
  getParentRoute: () => contactsParentRoute,
  path: '/',
  component: ContactsListPage,
})
const contactDetailRoute = createRoute({
  getParentRoute: () => contactsParentRoute,
  path: '$id',
  component: ContactDetailPage,
})

// Agents
const agentsParentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  beforeLoad: requireSession,
})
const agentsIndexRoute = createRoute({
  getParentRoute: () => agentsParentRoute,
  path: '/',
  component: AgentsListPage,
})
const agentsLearningsRoute = createRoute({
  getParentRoute: () => agentsParentRoute,
  path: '/learnings',
  component: AgentsLearningsPage,
})

// Drive
const driveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/drive',
  component: DrivePage,
  beforeLoad: requireSession,
})

// Channels
const channelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/channels',
  component: ChannelsPage,
  beforeLoad: requireSession,
})

// Settings routes
const settingsParentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsLayout,
  beforeLoad: requireSession,
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile' })
  },
})

const settingsProfileRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: '/profile',
  component: ProfilePage,
})

const settingsAccountRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: '/account',
  component: AccountPage,
})

const settingsAppearanceRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: '/appearance',
  component: AppearancePage,
})

const settingsNotificationsRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: '/notifications',
  component: NotificationsPage,
})

const settingsDisplayRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: '/display',
  component: DisplayPage,
})

const settingsApiKeysRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: '/api-keys',
  component: ApiKeysPage,
})

// Auth routes
const authParentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: AuthLayout,
})

const authLoginRoute = createRoute({
  getParentRoute: () => authParentRoute,
  path: '/login',
  component: LoginPage,
})

const authPendingRoute = createRoute({
  getParentRoute: () => authParentRoute,
  path: '/pending',
  component: PendingPage,
})

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
  contactsParentRoute.addChildren([contactsIndexRoute, contactDetailRoute]),
  agentsParentRoute.addChildren([agentsIndexRoute, agentsLearningsRoute]),
  driveRoute,
  channelsRoute,
  settingsParentRoute.addChildren([
    settingsIndexRoute,
    settingsProfileRoute,
    settingsAccountRoute,
    settingsAppearanceRoute,
    settingsNotificationsRoute,
    settingsDisplayRoute,
    settingsApiKeysRoute,
  ]),
  authParentRoute.addChildren([authLoginRoute, authPendingRoute]),
  ...(testWebRoute ? [testWebRoute] : []),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
