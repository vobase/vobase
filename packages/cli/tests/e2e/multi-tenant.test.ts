/**
 * Multi-tenant smoke — same `@vobase/cli` binary, two synthetic tenants
 * with different module sets, two on-disk configs.
 *
 * Verifies: catalog discovery is fully tenant-driven; the CLI never bakes
 * a verb list into its source. (Slice §7.15.)
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
import { renderGlobalHelp } from '../../src/help'

interface TenantSpec {
  configName: string
  baseUrl: string
  verbs: ReadonlyArray<{ name: string; description: string }>
}

function buildTenant(spec: TenantSpec): { app: Hono; fetcher: typeof fetch } {
  const ctx: VerbContext = {
    organizationId: `org_${spec.configName}`,
    principal: { kind: 'apikey', id: 'usr_t' },
    role: 'admin',
  }
  const registry = new CliVerbRegistry()
  for (const v of spec.verbs) {
    registry.register(
      defineCliVerb({
        name: v.name,
        description: v.description,
        input: z.object({}),
        body: () => Promise.resolve({ ok: true as const, data: { tenant: spec.configName, verb: v.name } }),
        formatHint: 'json',
      }),
    )
  }
  const app = new Hono()
  app.route('/api/cli', createCatalogRoute({ registry }))
  app.route('/api/cli', createCliDispatchRoute({ registry, resolveContext: () => ctx }))
  const fetcher: typeof fetch = ((input, init) =>
    app.fetch(input instanceof Request ? input : new Request(String(input), init))) as typeof fetch
  return { app, fetcher }
}

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'vobase-multi-tenant-'))
}

describe('multi-tenant catalog', () => {
  it('serves different verb sets to two configs from the same client code', async () => {
    const acme = buildTenant({
      configName: 'acme',
      baseUrl: 'http://acme.test',
      verbs: [
        { name: 'widgets list', description: 'List widgets' },
        { name: 'widgets show', description: 'Show one widget' },
      ],
    })
    const foo = buildTenant({
      configName: 'foo',
      baseUrl: 'http://foo.test',
      verbs: [
        { name: 'gadgets list', description: 'List gadgets' },
        { name: 'gadgets archive', description: 'Archive a gadget' },
      ],
    })

    const home = makeHome()
    const acmeClient = new CatalogClient({
      configName: 'acme',
      baseUrl: 'http://acme.test',
      apiKey: 'k',
      home,
      fetcher: acme.fetcher,
    })
    const fooClient = new CatalogClient({
      configName: 'foo',
      baseUrl: 'http://foo.test',
      apiKey: 'k',
      home,
      fetcher: foo.fetcher,
    })

    const acmeCat = await acmeClient.load()
    const fooCat = await fooClient.load()

    expect(acmeCat.verbs.map((v) => v.name).sort()).toEqual(['widgets list', 'widgets show'])
    expect(fooCat.verbs.map((v) => v.name).sort()).toEqual(['gadgets archive', 'gadgets list'])

    // The two caches are independent files keyed on configName.
    expect(acmeClient.cachePath()).not.toBe(fooClient.cachePath())

    // --help renders different verb groups from each catalog.
    const acmeHelp = renderGlobalHelp(acmeCat)
    const fooHelp = renderGlobalHelp(fooCat)
    expect(acmeHelp).toContain('widgets')
    expect(acmeHelp).not.toContain('gadgets')
    expect(fooHelp).toContain('gadgets')
    expect(fooHelp).not.toContain('widgets')
  })

  it('isolates etags per tenant — drift on one does not invalidate the other', async () => {
    const acme = buildTenant({
      configName: 'acme',
      baseUrl: 'http://acme.test',
      verbs: [{ name: 'widgets list', description: 'd' }],
    })
    const foo = buildTenant({
      configName: 'foo',
      baseUrl: 'http://foo.test',
      verbs: [{ name: 'gadgets list', description: 'd' }],
    })
    const home = makeHome()
    const a = new CatalogClient({
      configName: 'acme',
      baseUrl: 'http://acme.test',
      apiKey: 'k',
      home,
      fetcher: acme.fetcher,
    })
    const f = new CatalogClient({
      configName: 'foo',
      baseUrl: 'http://foo.test',
      apiKey: 'k',
      home,
      fetcher: foo.fetcher,
    })
    const ae = (await a.load()).etag
    const fe = (await f.load()).etag
    expect(ae).not.toBe(fe)
  })
})
