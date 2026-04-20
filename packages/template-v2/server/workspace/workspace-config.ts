/**
 * Declarative workspace configuration merged from every module's manifest
 * plus the harness-owned `RUNTIME_OWNED_PATHS`. Consumed by:
 * - `bootModules()` at boot for collision detection (`validateManifests`).
 * - `createWorkspace()` at wake for frozen-eager materialization order.
 * - `ScopedFs` RO enforcement (Step 3 migration target).
 */

import type { ModuleInstance, WorkspacePath } from '@server/runtime/define-module'

/**
 * Workspace paths owned by the harness, not any module. Modules MUST NOT claim
 * any of these in their `manifest.workspace.owns`. Validator throws
 * `NamespaceViolationError` on overlap.
 *
 * Sources (per plan D3):
 * - `/workspace/AGENTS.md` — auto-generated from registered tools/commands/skills.
 * - `/workspace/tmp/` — stdout spill files keyed by tool call id.
 * - `/workspace/contact/drive/` — contact-scope uploads (harness routes, drive stores).
 * - `/workspace/contact/profile.md` — per-wake contact profile.
 * - `/workspace/contact/MEMORY.md` — per-wake contact working memory.
 * - `/workspace/skills/` — merged skill entries from every module's registerSkill.
 */
export const RUNTIME_OWNED_PATHS: readonly WorkspacePath[] = [
  { kind: 'exact', path: '/workspace/AGENTS.md' },
  { kind: 'prefix', path: '/workspace/tmp/' },
  { kind: 'prefix', path: '/workspace/contact/drive/' },
  { kind: 'exact', path: '/workspace/contact/profile.md' },
  { kind: 'exact', path: '/workspace/contact/MEMORY.md' },
  { kind: 'prefix', path: '/workspace/skills/' },
] as const

export interface WorkspaceOwnershipEntry {
  readonly moduleName: string
  readonly path: WorkspacePath
}

export interface MergedWorkspaceConfig {
  readonly owners: readonly WorkspaceOwnershipEntry[]
  readonly frozenEager: readonly WorkspaceOwnershipEntry[]
  readonly runtimeOwned: readonly WorkspacePath[]
}

/** Merges every module's `workspace` manifest entry with RUNTIME_OWNED_PATHS. */
export function buildWorkspaceConfig(modules: readonly ModuleInstance[]): MergedWorkspaceConfig {
  const owners: WorkspaceOwnershipEntry[] = []
  const frozenEager: WorkspaceOwnershipEntry[] = []
  for (const mod of modules) {
    const ws = mod.manifest.workspace
    if (!ws) continue
    for (const path of ws.owns) {
      owners.push({ moduleName: mod.name, path })
    }
    for (const path of ws.frozenEager ?? []) {
      frozenEager.push({ moduleName: mod.name, path })
    }
  }
  return { owners, frozenEager, runtimeOwned: RUNTIME_OWNED_PATHS }
}

/** True iff `target` falls under or equals `claim`. */
export function pathOverlaps(claim: WorkspacePath, target: WorkspacePath): boolean {
  if (claim.kind === 'prefix') {
    return target.path.startsWith(claim.path)
  }
  return target.path === claim.path
}
