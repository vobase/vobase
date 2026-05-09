import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { createCatalogRoute } from './catalog-route'
import { defineCliVerb } from './define'
import { CliVerbRegistry } from './registry'

function makeRegistry(): CliVerbRegistry {
  const r = new CliVerbRegistry()
  r.register(
    defineCliVerb({
      name: 'contacts list',
      description: 'List contacts',
      input: z.object({ limit: z.number().default(10) }),
      body: async () => ({ ok: true as const, data: [] }),
    }),
  )
  return r
}

/** Registry with verbs at different audience tiers. */
function makeMultiTierRegistry(): CliVerbRegistry {
  const r = new CliVerbRegistry()
  r.register(
    defineCliVerb({
      name: 'public verb',
      description: 'contact-visible',
      input: z.object({}),
      body: async () => ({ ok: true as const, data: null }),
      audience: 'contact',
    }),
  )
  r.register(
    defineCliVerb({
      name: 'staff verb',
      description: 'staff-only',
      input: z.object({}),
      body: async () => ({ ok: true as const, data: null }),
      audience: 'staff',
    }),
  )
  r.register(
    defineCliVerb({
      name: 'admin verb',
      description: 'admin-only',
      input: z.object({}),
      body: async () => ({ ok: true as const, data: null }),
      // audience defaults to 'admin'
    }),
  )
  return r
}

describe('createCatalogRoute', () => {
  it('returns 200 with body and ETag header on first request', async () => {
    const app = createCatalogRoute({ registry: makeRegistry() })
    const res = await app.request('/verbs')
    expect(res.status).toBe(200)
    const etag = res.headers.get('ETag')
    expect(etag).toBeTruthy()
    const body = (await res.json()) as { verbs: { name: string }[]; etag: string }
    expect(body.verbs.map((v) => v.name)).toEqual(['contacts list'])
    expect(body.etag).toBe(etag as string)
  })

  it('returns 304 when If-None-Match matches the current etag', async () => {
    const app = createCatalogRoute({ registry: makeRegistry() })
    const first = await app.request('/verbs')
    const etag = first.headers.get('ETag') as string
    const res = await app.request('/verbs', { headers: { 'If-None-Match': etag } })
    expect(res.status).toBe(304)
    expect(res.headers.get('ETag')).toBe(etag)
    expect(await res.text()).toBe('')
  })

  it('returns 412 with the new catalog body when If-None-Match is stale', async () => {
    const registry = makeRegistry()
    const app = createCatalogRoute({ registry })
    const res = await app.request('/verbs', { headers: { 'If-None-Match': 'stale-etag' } })
    expect(res.status).toBe(412)
    const body = (await res.json()) as { verbs: { name: string }[]; etag: string }
    expect(body.verbs.map((v) => v.name)).toEqual(['contacts list'])
    expect(body.etag).toBe(registry.catalog().etag)
  })

  it('reflects newly-registered verbs without restart', async () => {
    const registry = makeRegistry()
    const app = createCatalogRoute({ registry })
    const beforeRes = await app.request('/verbs')
    const beforeEtag = ((await beforeRes.json()) as { etag: string }).etag
    registry.register(
      defineCliVerb({
        name: 'contacts show',
        description: 'Show contact',
        input: z.object({ id: z.string() }),
        body: async () => ({ ok: true as const, data: null }),
      }),
    )
    const res = await app.request('/verbs')
    const body = (await res.json()) as { verbs: { name: string }[]; etag: string }
    expect(body.verbs.map((v) => v.name)).toEqual(['contacts list', 'contacts show'])
    expect(body.etag).not.toBe(beforeEtag)
  })
})

describe('createCatalogRoute audience filtering', () => {
  it('contact tier returns fewer verbs than admin tier', async () => {
    const registry = makeMultiTierRegistry()
    const contactApp = createCatalogRoute({
      registry,
      getAudience: (): 'contact' => 'contact',
    })
    const adminApp = createCatalogRoute({
      registry,
      getAudience: (): 'admin' => 'admin',
    })
    const contactBody = (await (await contactApp.request('/verbs')).json()) as { verbs: unknown[] }
    const adminBody = (await (await adminApp.request('/verbs')).json()) as { verbs: unknown[] }
    expect(contactBody.verbs.length).toBeLessThan(adminBody.verbs.length)
  })

  it('includes clientLatestVersion in response body when wired', async () => {
    const app = createCatalogRoute({
      registry: makeRegistry(),
      clientLatestVersion: '0.7.0',
    })
    const body = (await (await app.request('/verbs')).json()) as { clientLatestVersion?: string }
    expect(body.clientLatestVersion).toBe('0.7.0')
  })

  it('omits clientLatestVersion when opts does not include it', async () => {
    const app = createCatalogRoute({ registry: makeRegistry() })
    const body = (await (await app.request('/verbs')).json()) as Record<string, unknown>
    expect(Object.hasOwn(body, 'clientLatestVersion')).toBe(false)
  })
})
