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
import { VobaseCliCollisionError } from './dispatcher'
import type { VerbResult, VerbTransport } from './transport'

export interface CatalogVerb {
  name: string
  description: string
  /** JSON-Schema-shaped representation of the verb's input. */
  inputSchema: unknown
  route: string
  formatHint?: string
  rolesAllowed?: readonly string[]
}

export interface Catalog {
  verbs: readonly CatalogVerb[]
  /** Deterministic etag — sha256 over sorted verb shapes. */
  etag: string
}

export class CliVerbRegistry {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous verb store; per-call type is narrowed at dispatch.
  private readonly verbs = new Map<string, CliVerbDef<any, any>>()
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
    this.verbs.set(name, { ...verb, name, route })
    this.cachedCatalog = null
  }

  /** Lookup by exact name. */
  get(name: string): CliVerbDef | undefined {
    return this.verbs.get(name)
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
      })
      return result.ok
        ? { ok: true, data: result.data }
        : { ok: false, error: result.error, errorCode: result.errorCode }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      transport.recordEvent?.({
        verb: name,
        transport: transport.name,
        durationMs: Date.now() - startedAt,
        ok: false,
        errorCode: 'internal_error',
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
