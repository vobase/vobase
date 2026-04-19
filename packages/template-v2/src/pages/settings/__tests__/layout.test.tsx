import { describe, expect, it } from 'bun:test'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import SettingsLayout, { SETTINGS_NAV_ITEMS } from '../layout'

async function renderLayout(path = '/settings/profile') {
  const rootRoute = createRootRoute({ component: () => <SettingsLayout /> })
  const childRoutes = SETTINGS_NAV_ITEMS.map((item) =>
    createRoute({ getParentRoute: () => rootRoute, path: item.href, component: () => null }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(childRoutes),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('SETTINGS_NAV_ITEMS', () => {
  it('exports 6 nav items', () => {
    expect(SETTINGS_NAV_ITEMS).toHaveLength(6)
  })

  it('contains expected section labels', () => {
    const labels = SETTINGS_NAV_ITEMS.map((i) => i.label)
    for (const label of ['Profile', 'Account', 'Appearance', 'Notifications', 'Display', 'API Keys']) {
      expect(labels).toContain(label)
    }
  })
})

describe('SettingsLayout', () => {
  it('renders all nav item labels', async () => {
    const html = await renderLayout()
    expect(html).toContain('Profile')
    expect(html).toContain('Account')
    expect(html).toContain('API Keys')
  })

  it('mounts sub-nav via ContentLayout', async () => {
    const html = await renderLayout()
    expect(html).toContain('aria-label="Sub navigation"')
  })
})
