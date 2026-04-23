/**
 * Declarative workspace configuration for runtime-owned paths.
 *
 * Originally merged per-module manifest.workspace declarations with the
 * harness-owned `RUNTIME_OWNED_PATHS`. After slice 2c.3 deleted the
 * per-module manifest shape, only `RUNTIME_OWNED_PATHS` + `pathOverlaps`
 * survive — `createWorkspace()` at wake start is the only remaining
 * consumer.
 */

/**
 * A workspace location declaration. `prefix` owns an entire subtree;
 * `exact` owns a single virtual file.
 */
export type WorkspacePath =
  | { readonly kind: 'prefix'; readonly path: `/workspace/${string}/` }
  | { readonly kind: 'exact'; readonly path: `/workspace/${string}` }

export const RUNTIME_OWNED_PATHS: readonly WorkspacePath[] = [
  { kind: 'exact', path: '/workspace/AGENTS.md' },
  { kind: 'prefix', path: '/workspace/tmp/' },
  { kind: 'prefix', path: '/workspace/contact/drive/' },
  { kind: 'exact', path: '/workspace/contact/profile.md' },
  { kind: 'exact', path: '/workspace/contact/MEMORY.md' },
  { kind: 'prefix', path: '/workspace/skills/' },
] as const

/** True iff `target` falls under or equals `claim`. */
export function pathOverlaps(claim: WorkspacePath, target: WorkspacePath): boolean {
  if (claim.kind === 'prefix') {
    return target.path.startsWith(claim.path)
  }
  return target.path === claim.path
}
