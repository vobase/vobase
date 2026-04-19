import { describe, expect, it } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { SubNav } from '../sub-nav'

const items = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/account', label: 'Account' },
]

async function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: () => <SubNav items={items} /> })
  const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/profile', component: () => null })
  const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/account', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([profileRoute, accountRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('SubNav', () => {
  it('renders all item labels', async () => {
    const html = await renderAt('/settings/profile')
    expect(html).toContain('Profile')
    expect(html).toContain('Account')
  })

  it('renders item hrefs as anchor href attributes', async () => {
    const html = await renderAt('/settings/profile')
    expect(html).toContain('/settings/profile')
    expect(html).toContain('/settings/account')
  })

  it('active item gets aria-current="page"', async () => {
    const html = await renderAt('/settings/profile')
    expect(html).toContain('aria-current="page"')
  })

  it('only active item gets aria-current="page"', async () => {
    const html = await renderAt('/settings/account')
    const matches = [...html.matchAll(/aria-current="page"/g)]
    expect(matches.length).toBe(1)
  })

  it('renders icon when provided', async () => {
    const withIcon = [{ href: '/settings/profile', label: 'Profile', icon: <span>icon</span> }]
    const rootRoute = createRootRoute({ component: () => <SubNav items={withIcon} /> })
    const route = createRoute({ getParentRoute: () => rootRoute, path: '/settings/profile', component: () => null })
    const router = createRouter({
      routeTree: rootRoute.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/settings/profile'] }),
    })
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('icon')
  })
})
