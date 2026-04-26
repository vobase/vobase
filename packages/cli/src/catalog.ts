/**
 * Catalog client for `@vobase/cli`.
 *
 * The CLI binary has zero static knowledge of verbs. On every command the
 * resolver asks `CatalogClient.load()` which returns the latest verb list
 * from the tenant's `/api/cli/verbs` endpoint. The catalog is cached to
 * disk (`~/.vobase/<config>.cache.json`) keyed by config name; subsequent
 * commands reuse the cache until:
 *
 *   - the user passes `--refresh`, OR
 *   - the server returns 412 with a fresh body (etag mismatch — auto-swap)
 *
 * This is what makes the same binary work across tenants with different
 * module sets without any client-side rebuild.
 */

import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { configPath } from './config'
import { httpRpc } from './transport/http'

export interface CatalogVerb {
  name: string
  description: string
  inputSchema: unknown
  route: string
  formatHint?: string
  rolesAllowed?: readonly string[]
}

export interface Catalog {
  verbs: readonly CatalogVerb[]
  etag: string
}

export interface CatalogClientOpts {
  configName: string
  baseUrl: string
  apiKey: string
  /** Override fetch for tests. */
  fetcher?: typeof fetch
  /** Override home dir for tests. */
  home?: string
  /** Override cache TTL for tests (default 5 min). */
  cacheTtlMs?: number
}

/** Default fresh-cache window — past this the client revalidates with `If-None-Match`. */
const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheFile {
  fetchedAt: string
  catalog: Catalog
}

export class CatalogClient {
  private readonly opts: CatalogClientOpts

  constructor(opts: CatalogClientOpts) {
    this.opts = opts
  }

  /** Disk path of the cached catalog for this config. */
  cachePath(): string {
    // Place cache next to the config: ~/.vobase/<name>.cache.json
    const configFile = configPath(this.opts.configName, this.opts.home)
    const dir = configFile.replace(/[^/]+$/u, '').replace(/\/$/u, '')
    return join(dir, `${this.opts.configName}.cache.json`)
  }

  /**
   * Load the catalog.
   *
   * Common case: a fresh-enough disk cache short-circuits with zero HTTP — only
   * the verb-dispatch round-trip remains, matching the design's "first command
   * per session pays a discovery round-trip" pitch. Past `CACHE_TTL_MS` the
   * client validates with `If-None-Match`; on 412 mismatch the server ships
   * the new catalog inline.
   */
  async load({ refresh = false }: { refresh?: boolean } = {}): Promise<Catalog> {
    const ttl = this.opts.cacheTtlMs ?? CACHE_TTL_MS
    if (!refresh) {
      const cached = await this.readCache()
      if (cached) {
        const age = Date.now() - Date.parse(cached.fetchedAt)
        if (Number.isFinite(age) && age >= 0 && age < ttl) {
          return cached.catalog
        }
        const fresh = await this.fetchWithEtag(cached.catalog.etag)
        if (fresh) {
          await this.writeCache(fresh)
          return fresh
        }
        await this.touchCache(cached)
        return cached.catalog
      }
    }
    const fresh = await this.fetchFresh()
    await this.writeCache(fresh)
    return fresh
  }

  /** Find a verb by exact name in the cached catalog (no IO if cache exists). */
  async getVerb(name: string): Promise<CatalogVerb | undefined> {
    const cat = await this.load()
    return cat.verbs.find((v) => v.name === name)
  }

  /** Drop the cache so the next load forces a refetch. */
  async invalidate(): Promise<void> {
    const path = this.cachePath()
    const file = Bun.file(path)
    if (await file.exists()) {
      await rm(path, { force: true })
    }
  }

  private async readCache(): Promise<CacheFile | null> {
    const path = this.cachePath()
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    try {
      const raw = JSON.parse(await file.text()) as CacheFile
      if (!raw.catalog || !Array.isArray(raw.catalog.verbs) || typeof raw.catalog.etag !== 'string') return null
      return raw
    } catch {
      return null
    }
  }

  private async writeCache(catalog: Catalog): Promise<void> {
    const path = this.cachePath()
    const text = `${JSON.stringify({ fetchedAt: new Date().toISOString(), catalog }, null, 2)}\n`
    await Bun.write(path, text)
  }

  /** Slide the TTL window forward without rewriting the catalog body. */
  private async touchCache(prev: CacheFile): Promise<void> {
    await this.writeCache(prev.catalog)
  }

  /** Fetch the catalog unconditionally. Throws on auth or network failure. */
  private async fetchFresh(): Promise<Catalog> {
    const result = await httpRpc<Catalog>({
      baseUrl: this.opts.baseUrl,
      apiKey: this.opts.apiKey,
      route: '/api/cli/verbs',
      method: 'GET',
      fetcher: this.opts.fetcher,
    })
    if (!result.ok) throw new Error(`Failed to fetch verb catalog: ${result.error}`)
    return assertCatalog(result.data)
  }

  /**
   * Validate the cached etag with the server. Returns the new catalog if
   * the server replied 200 (no etag support) or 412 (mismatch with fresh
   * body), or `null` on 304 (cache still valid). Throws on auth / network
   * errors so the caller can surface them.
   */
  private async fetchWithEtag(etag: string): Promise<Catalog | null> {
    const result = await httpRpc<Catalog>({
      baseUrl: this.opts.baseUrl,
      apiKey: this.opts.apiKey,
      route: '/api/cli/verbs',
      method: 'GET',
      ifNoneMatch: etag,
      fetcher: this.opts.fetcher,
    })
    if (result.ok) return assertCatalog(result.data)
    if (result.errorCode === 'etag_mismatch') return assertCatalog(result.data)
    if (result.errorCode === 'not_modified') return null
    throw new Error(`Failed to validate verb catalog: ${result.error}`)
  }
}

function assertCatalog(value: unknown): Catalog {
  if (!value || typeof value !== 'object') throw new Error('Verb catalog response was not an object')
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj.verbs)) throw new Error('Verb catalog response missing `verbs` array')
  if (typeof obj.etag !== 'string') throw new Error('Verb catalog response missing `etag` string')
  return { verbs: obj.verbs as readonly CatalogVerb[], etag: obj.etag }
}
