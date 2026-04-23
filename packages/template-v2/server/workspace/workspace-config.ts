/**
 * Declarative workspace configuration for runtime-owned paths.
 *
 * After the unified path-space rename (slice 3d.1a/3d.1b), `RUNTIME_OWNED_PATHS`
 * is a documentation artefact — `createWorkspace()` builds the per-wake eager
 * list via `buildFrozenEagerPaths({ agentId, contactId, channelInstanceId })`
 * and uses this list only for manifest-overlap validation. Entries here are
 * static and do not interpolate per-wake nanoids — they describe the shape of
 * the runtime zones, not the literal paths seen at runtime.
 */

/**
 * A workspace location declaration. `prefix` owns an entire subtree;
 * `exact` owns a single virtual file.
 */
export type WorkspacePath =
  | { readonly kind: 'prefix'; readonly path: `/${string}/` }
  | { readonly kind: 'exact'; readonly path: `/${string}` }

export const RUNTIME_OWNED_PATHS: readonly WorkspacePath[] = [
  { kind: 'prefix', path: '/agents/' },
  { kind: 'prefix', path: '/contacts/' },
  { kind: 'prefix', path: '/drive/' },
  { kind: 'prefix', path: '/staff/' },
  { kind: 'prefix', path: '/tmp/' },
] as const

/** True iff `target` falls under or equals `claim`. */
export function pathOverlaps(claim: WorkspacePath, target: WorkspacePath): boolean {
  if (claim.kind === 'prefix') {
    return target.path.startsWith(claim.path)
  }
  return target.path === claim.path
}
