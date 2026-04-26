/**
 * `defineDeclarativeResource` — register a resource type so future install
 * handlers (added in Slice 3 alongside `vobase install --defaults`) can
 * locate its source files, body schema, and serializer.
 *
 * The factory is intentionally lightweight: it validates the config, stores
 * it in the module-level registry keyed by `kind`, and returns a typed
 * handle the caller can hold for service-side reads. The Drizzle table is
 * provided by the caller via `bindDeclarativeTable` (in `boot.ts`).
 */

import type { z } from 'zod'

import type { DeclarativeResource, ParseFileContext, ResourceFormat } from './types'

export interface DefineDeclarativeResourceOpts<TBody> {
  kind: string
  sourceGlobs: string | readonly string[]
  format: ResourceFormat
  bodySchema: z.ZodType<TBody>
  parsePath?: (ctx: ParseFileContext) => { slug: string; scope: string | null }
  serialize: (body: TBody) => string
}

const REGISTRY = new Map<string, DeclarativeResource<unknown>>()

export function defineDeclarativeResource<TBody>(
  opts: DefineDeclarativeResourceOpts<TBody>,
): DeclarativeResource<TBody> {
  if (!opts.kind || /[^a-z0-9_]/.test(opts.kind)) {
    throw new Error(`defineDeclarativeResource: invalid kind "${opts.kind}" — use snake_case (a-z, 0-9, _)`)
  }
  const existing = REGISTRY.get(opts.kind)
  if (existing) {
    throw new Error(`defineDeclarativeResource: kind "${opts.kind}" already registered`)
  }
  const resource: DeclarativeResource<TBody> = {
    kind: opts.kind,
    sourceGlobs: typeof opts.sourceGlobs === 'string' ? [opts.sourceGlobs] : [...opts.sourceGlobs],
    format: opts.format,
    bodySchema: opts.bodySchema,
    parsePath: opts.parsePath,
    serialize: opts.serialize,
  }
  REGISTRY.set(opts.kind, resource as DeclarativeResource<unknown>)
  return resource
}

/** All registered resources, in registration order. */
export function listDeclarativeResources(): readonly DeclarativeResource<unknown>[] {
  return [...REGISTRY.values()]
}

export function getDeclarativeResource(kind: string): DeclarativeResource<unknown> | undefined {
  return REGISTRY.get(kind)
}

/**
 * Test-only: clear the registry. Production code never calls this; the
 * registry is populated once at module-import time and read-only thereafter.
 */
export function __resetDeclarativeRegistryForTests(): void {
  REGISTRY.clear()
}
