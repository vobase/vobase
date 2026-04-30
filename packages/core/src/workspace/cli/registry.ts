/**
 * CliVerbRegistry — the per-runtime registry that collects every verb a
 * module registered via `ctx.cli.register(defineCliVerb(...))`. The catalog
 * endpoint serializes this registry; transports dispatch through it.
 *
 * One registry per runtime. Modules call `register(verb)` during `init`;
 * collisions throw `VobaseCliCollisionError` at boot (same shape used by
 * the role-aware just-bash dispatcher), so the bug is caught before any
 * agent or human dispatches anything.
 */

import { z } from 'zod'

import { type CliVerbDef, defaultRouteForVerb } from './define'
import type { VerbResult, VerbTransport } from './transport'

/**
 * Thrown when two modules register a verb under the same name. Boot-time
 * failure — caught by `bootModules` so the bug surfaces before any agent or
 * staff dispatches anything.
 */
export class VobaseCliCollisionError extends Error {
  override readonly name = 'VobaseCliCollisionError'
}

/**
 * Trust tier a verb is exposed to. See `CliVerbDef.audience` for the full
 * monotonic-tier semantics. Default `'admin'` so untagged verbs are invisible
 * to wakes — authors must opt into the lower tiers explicitly.
 */
export type AudienceTier = 'admin' | 'staff' | 'contact'

/**
 * Subset of `AudienceTier` that a wake can run at. `'admin'` only applies to
 * the actual `vobase` CLI binary (admin API key), never to a wake — wakes
 * always run at `'staff'` or `'contact'`.
 */
export type WakeAudienceTier = Extract<AudienceTier, 'staff' | 'contact'>

const TIER_ORDER: Record<AudienceTier, number> = { contact: 0, staff: 1, admin: 2 }

/**
 * Verb visibility rule for a given wake tier. A verb is visible iff its
 * required tier is `<=` the wake's tier (contact ≤ staff ≤ admin). Used by
 * both the AGENTS.md materializer and the in-bash transport's `--help`.
 */
export function isVerbVisible(verbAudience: AudienceTier | undefined, wakeTier: WakeAudienceTier): boolean {
  return TIER_ORDER[verbAudience ?? 'admin'] <= TIER_ORDER[wakeTier]
}

export interface CatalogVerb {
  name: string
  description: string
  /** JSON-Schema-shaped representation of the verb's input. */
  inputSchema: unknown
  route: string
  formatHint?: string
  rolesAllowed?: readonly string[]
  /**
   * Trust tier the verb is exposed to. Default `'admin'`. Filtering by wake
   * tier happens in the AGENTS.md materializer + in-bash transport — the CLI
   * binary's HTTP-RPC dispatch is admin-tier (api-key authenticated) and sees
   * every verb regardless.
   */
  audience?: AudienceTier
}

export interface Catalog {
  verbs: readonly CatalogVerb[]
  /** Deterministic etag — sha256 over sorted verb shapes. */
  etag: string
}

export class CliVerbRegistry {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous verb store; per-call type is narrowed at dispatch.
  private readonly verbs = new Map<string, CliVerbDef<any, any>>()
  // biome-ignore lint/suspicious/noExplicitAny: parallel index for O(1) HTTP-route lookup.
  private readonly byRoute = new Map<string, CliVerbDef<any, any>>()
  private cachedCatalog: Catalog | null = null

  /** Register a verb. Throws on duplicate name. */
  register<TInput, TOutput>(verb: CliVerbDef<TInput, TOutput>): void {
    const name = verb.name.trim()
    if (this.verbs.has(name)) {
      throw new VobaseCliCollisionError(
        `vobase CLI: duplicate verb "${name}" registered twice; rename one to avoid ambiguity.`,
      )
    }
    const route = verb.route ?? defaultRouteForVerb(name)
    const stored = { ...verb, name, route }
    this.verbs.set(name, stored)
    this.byRoute.set(route, stored)
    this.cachedCatalog = null
  }

  /** Register a heterogeneous set of verbs in one call (mirrors register's semantics). */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous verb tuple — TInput is contravariant in verb body, narrow type fights the assignment.
  registerAll(verbs: readonly CliVerbDef<any, any>[]): void {
    for (const verb of verbs) this.register(verb)
  }

  /** Lookup by exact name. */
  get(name: string): CliVerbDef | undefined {
    return this.verbs.get(name)
  }

  /** O(1) lookup by HTTP route — used by the dispatch endpoint. */
  getByRoute(route: string): CliVerbDef | undefined {
    return this.byRoute.get(route)
  }

  /** All verbs sorted by name, for catalog rendering and help. */
  list(): readonly CliVerbDef[] {
    return [...this.verbs.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Number of registered verbs. */
  size(): number {
    return this.verbs.size
  }

  /**
   * Build the catalog payload + deterministic etag. Cached after first call —
   * the registry is immutable post-boot, so the catalog endpoint can call
   * this on every request without re-running zod→JSON-Schema conversion.
   */
  catalog(): Catalog {
    if (this.cachedCatalog) return this.cachedCatalog
    const verbs: CatalogVerb[] = this.list().map((v) => ({
      name: v.name,
      description: v.description,
      inputSchema: zodToJsonSchemaSafe(v.inputSchema),
      route: v.route as string,
      formatHint: v.formatHint,
      rolesAllowed: v.rolesAllowed,
      audience: v.audience,
    }))
    this.cachedCatalog = { verbs, etag: computeEtag(verbs) }
    return this.cachedCatalog
  }

  /**
   * Dispatch a verb through a transport. Validates the parsed input against
   * the verb's `inputSchema`; returns a typed `VerbResult`. The transport's
   * `resolveContext` is invoked once per call.
   */
  async dispatch(name: string, rawInput: unknown, transport: VerbTransport): Promise<VerbResult> {
    const verb = this.verbs.get(name)
    if (!verb) {
      return { ok: false, error: `Unknown verb "${name}"`, errorCode: 'unknown_verb' }
    }
    const parsed = verb.inputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: `Input validation failed: ${parsed.error.message}`, errorCode: 'invalid_input' }
    }
    const ctx = await transport.resolveContext()
    // Audience filtering happens at the surface layer — the AGENTS.md
    // materializer + in-bash transport's `--help` filter by wake tier; the
    // CLI binary's HTTP-RPC dispatch is admin-tier (api-key authenticated)
    // and sees every verb regardless. No tier gate here.
    if (verb.rolesAllowed && verb.rolesAllowed.length > 0 && (!ctx.role || !verb.rolesAllowed.includes(ctx.role))) {
      return { ok: false, error: `Role "${ctx.role ?? 'none'}" not allowed for verb "${name}"`, errorCode: 'forbidden' }
    }
    const startedAt = Date.now()
    try {
      const result = await verb.body({ input: parsed.data, ctx })
      transport.recordEvent?.({
        verb: name,
        transport: transport.name,
        durationMs: Date.now() - startedAt,
        ok: result.ok,
        errorCode: result.ok ? undefined : result.errorCode,
        readOnly: verb.readOnly,
      })
      return result.ok
        ? { ok: true, data: result.data, summary: result.summary }
        : { ok: false, error: result.error, errorCode: result.errorCode }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      transport.recordEvent?.({
        verb: name,
        transport: transport.name,
        durationMs: Date.now() - startedAt,
        ok: false,
        errorCode: 'internal_error',
        readOnly: verb.readOnly,
      })
      return { ok: false, error: message, errorCode: 'internal_error' }
    }
  }
}

/** Best-effort Zod → JSON Schema conversion for catalog serialization. */
function zodToJsonSchemaSafe(schema: z.ZodType<unknown>): unknown {
  try {
    return z.toJSONSchema(schema)
  } catch {
    return { type: 'object', description: '(schema not serializable)' }
  }
}

/** Deterministic sha256 over sorted verb shapes. */
function computeEtag(verbs: readonly CatalogVerb[]): string {
  const payload = JSON.stringify(
    verbs.map((v) => [v.name, v.route, v.description, v.formatHint ?? '', v.rolesAllowed ?? []]),
  )
  // Bun and Node both expose this synchronous API.
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(payload)
  return hasher.digest('hex')
}
