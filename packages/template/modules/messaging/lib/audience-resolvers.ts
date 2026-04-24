import type { ModuleInitContext } from '@vobase/core'

export interface AudienceResolverResult {
  contactId: string
  variables?: Record<string, unknown>
}

export type AudienceResolver<TParams = unknown> = (
  ctx: ModuleInitContext,
  params: TParams,
) => Promise<AudienceResolverResult[]>

const resolvers = new Map<string, AudienceResolver>()
let resolverCtx: ModuleInitContext | undefined

export function registerAudienceResolver(name: string, fn: AudienceResolver): void {
  if (resolvers.has(name)) {
    throw new Error(`[audience-resolvers] resolver "${name}" is already registered`)
  }
  resolvers.set(name, fn)
}

export function getAudienceResolver(name: string): AudienceResolver | undefined {
  return resolvers.get(name)
}

/** Set by the messaging module init hook so the engine can invoke resolvers. */
export function setResolverContext(ctx: ModuleInitContext): void {
  resolverCtx = ctx
}

export function getResolverContext(): ModuleInitContext {
  if (!resolverCtx) {
    throw new Error('[audience-resolvers] context not initialized')
  }
  return resolverCtx
}

/** Test-only reset. */
export function __resetAudienceResolvers(): void {
  resolvers.clear()
  resolverCtx = undefined
}
