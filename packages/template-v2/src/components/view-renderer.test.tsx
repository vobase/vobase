/**
 * `<ViewRenderer />` smoke test — renders against stubbed `viewsClient` and a
 * `QueryClient` pre-seeded with the saved-view + rows payload, so React Query
 * skips its async refetch and the component renders synchronously into the
 * static-markup tree.
 */

import { describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('nuqs', () => ({
  useQueryStates: () => [{ page: 1, pageSize: 50, sortColumn: null, sortDirection: null, filters: null }, () => {}],
  parseAsInteger: { withDefault: (_: number) => ({}) },
  parseAsJson: <T,>(_fn: (v: unknown) => T) => ({}),
  parseAsString: {},
}))

mock.module('@/lib/api-client', () => ({
  viewsClient: {
    ':slug': { $get: mock(async () => ({ ok: true, status: 200, json: async () => null })) },
    query: {
      $post: mock(async () => ({ ok: true, json: async () => ({ scope: 'object:contacts', rows: [], total: 0 }) })),
    },
  },
}))

import { ViewRenderer } from '@/components/view-renderer'

function renderWithClient(node: React.ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  })
  // Pre-seed query data so React renders synchronously without firing fetch.
  client.setQueryData(['saved-views', 'object:contacts', 'pending-outreach'], {
    name: 'Pending Outreach',
    kind: 'table',
    columns: ['displayName', 'phone', 'email', 'updatedAt'],
    sort: [{ column: 'updatedAt', direction: 'desc' }],
  })
  client.setQueryData(
    ['view-rows', 'object:contacts', 'pending-outreach', [{ column: 'updatedAt', direction: 'desc' }], [], 1, 50],
    {
      scope: 'object:contacts',
      total: 1,
      rows: [{ displayName: 'Ada Lovelace', phone: '+44 7000', email: 'ada@example.com', updatedAt: '2026-04-01' }],
    },
  )
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe('<ViewRenderer />', () => {
  it('renders saved-view columns + row data when query cache is hot', () => {
    const html = renderWithClient(<ViewRenderer scope="object:contacts" slug="pending-outreach" />)
    expect(html).toContain('Display Name')
    expect(html).toContain('Phone')
    expect(html).toContain('Email')
    expect(html).toContain('Updated At')
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('ada@example.com')
  })

  it('renders an Empty placeholder for unimplemented kinds (kanban / calendar / …)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
    client.setQueryData(['saved-views', 'object:contacts', 'kanban-only'], {
      name: 'Kanban Demo',
      kind: 'kanban',
      columns: ['displayName'],
    })
    client.setQueryData(['view-rows', 'object:contacts', 'kanban-only', [], [], 1, 50], {
      scope: 'object:contacts',
      total: 0,
      rows: [],
    })
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ViewRenderer scope="object:contacts" slug="kanban-only" />
      </QueryClientProvider>,
    )
    expect(html).toContain('Kanban view not implemented yet')
  })

  it('coerces null/array cells through stringifyCell', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
    client.setQueryData(['saved-views', 'object:contacts', 'mixed'], {
      name: 'Mixed',
      kind: 'table',
      columns: ['name', 'segments', 'optedOut'],
    })
    client.setQueryData(['view-rows', 'object:contacts', 'mixed', [], [], 1, 50], {
      scope: 'object:contacts',
      total: 1,
      rows: [{ name: null, segments: ['vip', 'beta'], optedOut: true }],
    })
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ViewRenderer scope="object:contacts" slug="mixed" />
      </QueryClientProvider>,
    )
    expect(html).toContain('—')
    expect(html).toContain('vip, beta')
    expect(html).toContain('Yes')
  })
})
