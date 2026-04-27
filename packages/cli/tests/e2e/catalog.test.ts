/**
 * Catalog conformance e2e — register a synthetic `widgets list` verb in a
 * fake "tenant module," start an in-memory Hono app with the catalog +
 * dispatch routes, and verify the @vobase/cli binary fetches the catalog
 * and dispatches `vobase widgets list` correctly without any CLI source
 * changes.
 *
 * This is the load-bearing test for the catalog-driven design: if the same
 * binary can serve a tenant whose module set the binary has never seen,
 * the catalog contract holds. (Slice §7.14.)
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { VerbContext } from '@vobase/core'
import { CliVerbRegistry, createCatalogRoute, createCliDispatchRoute, defineCliVerb } from '@vobase/core'
import { Hono } from 'hono'
import { z } from 'zod'

import { CatalogClient } from '../../src/catalog'
import { resolve as resolveVerb } from '../../src/resolver'

const TEST_CTX: VerbContext = {
  organizationId: 'org_acme',
  principal: { kind: 'apikey', id: 'usr_alice' },
  role: 'admin',
}

function makeFetcher(app: Hono): typeof fetch {
  const fn = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input.toString(), init)
    return await app.fetch(req)
  }
  return fn as unknown as typeof fetch
}

function buildSyntheticTenant(): { app: Hono; registry: CliVerbRegistry } {
  const registry = new CliVerbRegistry()
  registry.registerAll([
    defineCliVerb({
      name: 'widgets list',
      description: 'List widgets in this tenant.',
      input: z.object({ limit: z.number().int().positive().max(100).default(10) }),
      body: ({ input }) =>
        Promise.resolve({
          ok: true as const,
          data: Array.from({ length: input.limit }, (_, i) => ({ id: `wgt_${i}`, label: `Widget #${i}` })),
        }),
      formatHint: 'table:cols=id,label',
    }),
    defineCliVerb({
      name: 'widgets show',
      description: 'Show a single widget by id.',
      input: z.object({ id: z.string().min(1) }),
      body: ({ input }) =>
        Promise.resolve({ ok: true as const, data: { id: input.id, label: `Widget for ${input.id}` } }),
      formatHint: 'json',
    }),
  ])

  const app = new Hono()
  app.route('/api/cli', createCatalogRoute({ registry }))
  app.route('/api/cli', createCliDispatchRoute({ registry, resolveContext: () => TEST_CTX }))
  return { app, registry }
}

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'vobase-cli-conformance-'))
}

describe('catalog conformance', () => {
  it('discovers a tenant-defined verb and dispatches it via the same CLI surface', async () => {
    const { app, registry } = buildSyntheticTenant()
    const fetcher = makeFetcher(app)
    const home = makeHome()

    const client = new CatalogClient({
      configName: 'acme',
      baseUrl: 'http://acme.test',
      apiKey: 'vbt_anything',
      home,
      fetcher,
    })

    // The CLI hasn't been told about `widgets` — it discovers via the catalog.
    const catalog = await client.load()
    expect(catalog.verbs.map((v) => v.name).sort()).toEqual(['widgets list', 'widgets show'])
    expect(catalog.etag).toBe(registry.catalog().etag)

    const result = await resolveVerb({
      argv: ['widgets', 'list', '--limit=3'],
      catalog,
      baseUrl: 'http://acme.test',
      apiKey: 'vbt_anything',
      format: 'json',
      fetcher,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const parsed = JSON.parse(result.output) as Array<{ id: string; label: string }>
      expect(parsed).toHaveLength(3)
      expect(parsed[0]).toEqual({ id: 'wgt_0', label: 'Widget #0' })
    }
  })

  it('renders the catalog formatHint for human output', async () => {
    const { app } = buildSyntheticTenant()
    const fetcher = makeFetcher(app)
    const home = makeHome()
    const client = new CatalogClient({
      configName: 'acme',
      baseUrl: 'http://acme.test',
      apiKey: 'vbt_anything',
      home,
      fetcher,
    })
    const catalog = await client.load()

    const result = await resolveVerb({
      argv: ['widgets', 'list', '--limit=2'],
      catalog,
      baseUrl: 'http://acme.test',
      apiKey: 'vbt_anything',
      format: 'human',
      fetcher,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // table:cols=id,label hint produces a column-aligned text block (uppercase headers).
      expect(result.output).toContain('ID')
      expect(result.output).toContain('LABEL')
      expect(result.output).toContain('wgt_0')
    }
  })

  it('handles catalog 412 mismatch by fetching the new shape inline', async () => {
    const { app, registry } = buildSyntheticTenant()
    const appRef = app
    const fetcher: typeof fetch = ((input, init) =>
      appRef.fetch(input instanceof Request ? input : new Request(String(input), init))) as typeof fetch
    const home = makeHome()
    const client = new CatalogClient({
      configName: 'acme',
      baseUrl: 'http://acme.test',
      apiKey: 'vbt_anything',
      home,
      fetcher,
      cacheTtlMs: 0, // force etag revalidation on every load
    })

    // Prime the cache.
    const before = await client.load()
    expect(before.verbs.map((v) => v.name)).toContain('widgets list')

    // Tenant adds a new verb — same registry instance, so the cached catalog drifts.
    registry.register(
      defineCliVerb({
        name: 'gizmos list',
        description: 'List gizmos.',
        input: z.object({}),
        body: () => Promise.resolve({ ok: true as const, data: [] }),
        formatHint: 'json',
      }),
    )
    void appRef

    const after = await client.load()
    expect(after.etag).not.toBe(before.etag)
    expect(after.verbs.map((v) => v.name).sort()).toEqual(['gizmos list', 'widgets list', 'widgets show'])
  })
})
