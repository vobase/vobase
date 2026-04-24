import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'

import { Breadcrumbs } from '../breadcrumbs'

function makeRouter(path: string, queryClient: QueryClient) {
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Breadcrumbs />
      </QueryClientProvider>
    ),
  })
  const messagingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/messaging', component: () => null })
  const messagingDetailRoute = createRoute({ getParentRoute: () => messagingRoute, path: '$id', component: () => null })
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => null })
  const profileRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/profile', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      messagingRoute.addChildren([messagingDetailRoute]),
      settingsRoute.addChildren([profileRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return router
}

describe('Breadcrumbs', () => {
  it('renders messaging segment at /messaging', async () => {
    const qc = new QueryClient()
    const router = makeRouter('/messaging', qc)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('Messaging')
  })

  it('renders nested settings/profile breadcrumbs', async () => {
    const qc = new QueryClient()
    const router = makeRouter('/settings/profile', qc)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('Settings')
    expect(html).toContain('Profile')
  })

  it('shows conv subject from query cache for /messaging/$id', async () => {
    const convId = 'aabbccdd-1122-3344-5566-778899001122'
    const qc = new QueryClient()
    qc.setQueryData(['messaging-threads', convId], { subject: 'Budget proposal Q3' })
    const router = makeRouter(`/messaging/${convId}`, qc)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('Budget proposal Q3')
  })

  it('shows first 8 chars of UUID when conv not in cache for /messaging/$id', async () => {
    const convId = 'ff112233-aabb-ccdd-eeff-001122334455'
    const qc = new QueryClient()
    const router = makeRouter(`/messaging/${convId}`, qc)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('ff112233')
    expect(html).not.toContain('Budget proposal')
  })

  it('renders last breadcrumb as current page (aria-current=page)', async () => {
    const qc = new QueryClient()
    const router = makeRouter('/messaging', qc)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('aria-current="page"')
  })
})
