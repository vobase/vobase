import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'

import { ThemeProvider } from '@/components/theme-provider'
import { AppShell } from '../app-shell'

// ThemeProvider (via TopHeader → ThemeSwitch) reads localStorage and window.matchMedia during render
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

async function renderShell(path = '/messaging') {
  const qc = new QueryClient()
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <AppShell>
            <div>content</div>
          </AppShell>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('AppShell', () => {
  it('renders module navigation landmark', async () => {
    const html = await renderShell()
    expect(html).toContain('aria-label="Module navigation"')
  })

  it('renders at least 6 nav items', async () => {
    const html = await renderShell()
    // Each nav item has an aria-label on its trigger
    const matches = [...html.matchAll(/aria-label="(Inbox|Workspace|Contacts|Agents|Drive|Team|Channels|Settings)"/g)]
    expect(matches.length).toBeGreaterThanOrEqual(6)
  })

  it('renders rail separator', async () => {
    const html = await renderShell()
    expect(html).toContain('data-slot="separator"')
  })

  it('renders nav-user dropdown trigger', async () => {
    const html = await renderShell()
    expect(html).toContain('aria-label="User menu"')
  })

  it('all rail items render as enabled links, not disabled buttons', async () => {
    const html = await renderShell()
    // Every NAV_ITEMS entry is enabled=true, so none should carry aria-disabled.
    for (const label of ['Inbox', 'Workspace', 'Contacts', 'Agents', 'Drive', 'Team', 'Channels', 'Settings']) {
      const match = html.match(new RegExp(`aria-label="${label}"[^>]*>`))
      expect(match).toBeTruthy()
      expect(match?.[0]).not.toContain('aria-disabled')
    }
    // Sanity: the disabled-stub styling token is absent when every item is enabled.
    expect(html).not.toContain('opacity-40')
  })

  it('renders children content', async () => {
    const html = await renderShell()
    expect(html).toContain('content')
  })
})
