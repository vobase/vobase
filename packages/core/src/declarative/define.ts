/**
 * `defineDeclarativeResource` — register a resource type so the boot
 * reconciler will pick up its source files and seed / update the matching
 * Drizzle table.
 *
 * The factory itself is intentionally lightweight: it validates the config,
 * stores it in the module-level registry keyed by `kind`, and returns a
 * typed handle the caller can hold for service-side reads. The reconciler
 * driver (`reconcile.ts`) walks the registry; nothing else does.
 *
 * The Drizzle table object is provided by the caller (Drizzle requires
 * static table declarations for migration generation), so this factory
 * doesn't dynamically create tables — it just attaches reconciler behavior
 * to one.
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
