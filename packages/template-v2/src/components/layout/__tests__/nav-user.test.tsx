import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type * as React from 'react'
import { renderToString } from 'react-dom/server'
import { NavUser } from '../nav-user'

function makeRouter(component: React.FC) {
  const rootRoute = createRootRoute({ component })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return router
}

function render(node: React.ReactNode): string {
  const client = new QueryClient()
  return renderToString(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe('NavUser', () => {
  it('renders user menu trigger button', async () => {
    const router = makeRouter(() => <NavUser />)
    await router.load()
    const html = render(<RouterProvider router={router} />)
    expect(html).toContain('aria-label="User menu"')
  })

  it('renders an avatar fallback when no session', async () => {
    // SSR has no session; useSession returns undefined and the fallback "??" renders.
    const router = makeRouter(() => <NavUser />)
    await router.load()
    const html = render(<RouterProvider router={router} />)
    expect(html).toContain('??')
  })
})
