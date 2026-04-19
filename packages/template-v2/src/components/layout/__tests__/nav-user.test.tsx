import { describe, expect, it } from 'bun:test'
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

describe('NavUser', () => {
  it('renders user menu trigger button', async () => {
    const router = makeRouter(() => <NavUser name="Alice Johnson" />)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('aria-label="User menu"')
  })

  it('renders initials from name', async () => {
    const router = makeRouter(() => <NavUser name="Carl Luo" />)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('CL')
  })

  it('renders default user when no props', async () => {
    const router = makeRouter(() => <NavUser />)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('aria-label="User menu"')
    expect(html).toContain('U')
  })

  it('renders user name in trigger', async () => {
    const router = makeRouter(() => <NavUser name="Jane Doe" />)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('Jane Doe')
  })

  it('renders without error when email is provided', async () => {
    // DropdownMenuContent renders in a portal (not in SSR output) — just verify no throw
    const router = makeRouter(() => <NavUser name="Carl" email="carl@voltade.com" />)
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('aria-label="User menu"')
  })
})
