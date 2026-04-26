import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { type Catalog, CatalogClient } from './catalog'

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'vobase-catalog-test-'))
}

const exampleCatalog: Catalog = {
  verbs: [
    {
      name: 'contacts list',
      description: 'List contacts',
      inputSchema: { type: 'object' },
      route: '/api/cli/contacts/list',
      formatHint: 'table:cols=id',
    },
  ],
  etag: 'etag-1',
}

function makeFetcher(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  const fn = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input.toString(), init)
    return await handler(req)
  }
  return fn as unknown as typeof fetch
}

describe('CatalogClient.load', () => {
  it('fetches fresh on first call and writes cache', async () => {
    const home = makeHome()
    let calls = 0
    const fetcher = makeFetcher(() => {
      calls += 1
      return new Response(JSON.stringify(exampleCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const client = new CatalogClient({ configName: 'acme', baseUrl: 'https://x', apiKey: 'k', home, fetcher })
    const cat = await client.load()
    expect(calls).toBe(1)
    expect(cat.verbs.map((v) => v.name)).toEqual(['contacts list'])
    // Cache file written.
    expect(await Bun.file(client.cachePath()).exists()).toBe(true)
  })

  it('skips network when cache is within TTL (common case)', async () => {
    const home = makeHome()
    let calls = 0
    const fetcher = makeFetcher(() => {
      calls += 1
      return new Response(JSON.stringify(exampleCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const client = new CatalogClient({ configName: 'acme', baseUrl: 'https://x', apiKey: 'k', home, fetcher })
    await client.load()
    await client.load()
    expect(calls).toBe(1)
  })

  it('issues etag-validation GET when cache is past TTL', async () => {
    const home = makeHome()
    const calls: { ifNoneMatch: string | null }[] = []
    const fetcher = makeFetcher((req) => {
      calls.push({ ifNoneMatch: req.headers.get('If-None-Match') })
      if (req.headers.has('If-None-Match')) return new Response(null, { status: 304 })
      return new Response(JSON.stringify(exampleCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const client = new CatalogClient({
      configName: 'acme',
      baseUrl: 'https://x',
      apiKey: 'k',
      home,
      fetcher,
      cacheTtlMs: 0,
    })
    await client.load()
    const cat2 = await client.load()
    expect(cat2.verbs).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls[0].ifNoneMatch).toBeNull()
    expect(calls[1].ifNoneMatch).toBe('etag-1')
  })

  it('refetches when --refresh is passed regardless of cache', async () => {
    const home = makeHome()
    let calls = 0
    const fetcher = makeFetcher(() => {
      calls += 1
      return new Response(JSON.stringify(exampleCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const client = new CatalogClient({ configName: 'acme', baseUrl: 'https://x', apiKey: 'k', home, fetcher })
    await client.load()
    await client.load({ refresh: true })
    expect(calls).toBe(2)
  })

  it('swaps cache transparently on 412 etag-mismatch', async () => {
    const home = makeHome()
    const fresh: Catalog = {
      verbs: [
        {
          name: 'contacts list',
          description: 'List contacts',
          inputSchema: { type: 'object' },
          route: '/api/cli/contacts/list',
        },
        {
          name: 'widgets list',
          description: 'New tenant verb',
          inputSchema: { type: 'object' },
          route: '/api/cli/widgets/list',
        },
      ],
      etag: 'etag-2',
    }
    let n = 0
    const fetcher = makeFetcher((req) => {
      n += 1
      if (n === 1) {
        return new Response(JSON.stringify(exampleCatalog), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Validation call — return 412 with the new catalog body.
      expect(req.headers.get('If-None-Match')).toBe('etag-1')
      return new Response(JSON.stringify(fresh), {
        status: 412,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const client = new CatalogClient({
      configName: 'acme',
      baseUrl: 'https://x',
      apiKey: 'k',
      home,
      fetcher,
      cacheTtlMs: 0,
    })
    await client.load()
    const cat2 = await client.load()
    expect(cat2.etag).toBe('etag-2')
    expect(cat2.verbs.map((v) => v.name)).toEqual(['contacts list', 'widgets list'])
  })

  it('getVerb finds by exact name', async () => {
    const home = makeHome()
    const fetcher = makeFetcher(
      () =>
        new Response(JSON.stringify(exampleCatalog), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const client = new CatalogClient({ configName: 'acme', baseUrl: 'https://x', apiKey: 'k', home, fetcher })
    const verb = await client.getVerb('contacts list')
    expect(verb?.route).toBe('/api/cli/contacts/list')
    expect(await client.getVerb('does-not-exist')).toBeUndefined()
  })

  it('throws on malformed catalog response', async () => {
    const home = makeHome()
    const fetcher = makeFetcher(
      () =>
        new Response(JSON.stringify({ wrong: 'shape' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const client = new CatalogClient({ configName: 'acme', baseUrl: 'https://x', apiKey: 'k', home, fetcher })
    await expect(client.load()).rejects.toThrow(/missing `verbs`/)
  })

  it('invalidate removes the cache file', async () => {
    const home = makeHome()
    const fetcher = makeFetcher(
      () =>
        new Response(JSON.stringify(exampleCatalog), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const client = new CatalogClient({ configName: 'acme', baseUrl: 'https://x', apiKey: 'k', home, fetcher })
    await client.load()
    expect(await Bun.file(client.cachePath()).exists()).toBe(true)
    await client.invalidate()
    expect(await Bun.file(client.cachePath()).exists()).toBe(false)
  })
})
