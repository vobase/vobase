import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { ThemeProvider } from '@/components/theme-provider'
import { TopHeader } from '../top-header'

// ThemeProvider reads localStorage and window.matchMedia during render
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, length: 0, key: () => null },
  writable: true,
  configurable: true,
})
Object.defineProperty(globalThis, 'window', {
  value: { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) },
  writable: true,
  configurable: true,
})

function makeRouter(path = '/messaging') {
  const qc = new QueryClient()
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <TopHeader />
        </ThemeProvider>
      </QueryClientProvider>
    ),
  })
  const messagingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/messaging', component: () => null })
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([messagingRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return router
}

describe('TopHeader', () => {
  it('renders the header element', async () => {
    const router = makeRouter()
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('<header')
    expect(html).toContain('sticky')
  })

  it('mounts ThemeSwitch — toggle theme button present', async () => {
    const router = makeRouter()
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('aria-label="Toggle theme"')
  })

  it('renders search button placeholder (disabled)', async () => {
    const router = makeRouter()
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('aria-label="Search (coming soon)"')
    expect(html).toContain('disabled')
  })

  it('renders breadcrumb nav element', async () => {
    const router = makeRouter()
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('aria-label="breadcrumb"')
  })

  it('is a sticky 64px bar (h-16 class)', async () => {
    const router = makeRouter()
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('h-16')
    expect(html).toContain('sticky')
  })
})
