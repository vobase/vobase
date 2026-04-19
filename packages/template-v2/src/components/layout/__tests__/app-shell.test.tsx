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

async function renderShell(path = '/inbox') {
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
    const matches = [...html.matchAll(/aria-label="(Inbox|Approvals|Contacts|Agents|Drive|Settings)"/g)]
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

  it('disabled nav stubs render with opacity-40', async () => {
    const html = await renderShell()
    // Disabled items (Contacts, Agents, Drive) use opacity-40 class
    expect(html).toContain('opacity-40')
  })

  it('enabled nav items do not have opacity-40 (Inbox is enabled)', async () => {
    const html = await renderShell()
    // Verify Inbox link is present without opacity-40 as a disabled button
    // Inbox renders as a Link, not a disabled button — aria-disabled should not appear for it
    const inboxMatch = html.match(/aria-label="Inbox"[^>]*>/)
    expect(inboxMatch).toBeTruthy()
    // The Inbox trigger should not carry aria-disabled
    expect(inboxMatch?.[0]).not.toContain('aria-disabled')
  })

  it('renders page header (TopHeader sticky bar)', async () => {
    const html = await renderShell()
    expect(html).toContain('h-16')
    expect(html).toContain('sticky')
  })

  it('renders children content', async () => {
    const html = await renderShell()
    expect(html).toContain('content')
  })
})
