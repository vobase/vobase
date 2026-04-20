/**
 * Boot-time manifest validators. Run inside `bootModules()` after `sortModules(...)`
 * and before any `mod.init(ctx)` call.
 *
 * Static checks (this file):
 * (a) no overlapping `workspace.owns` prefixes between modules
 * (b) no module `workspace.owns` overlaps `RUNTIME_OWNED_PATHS`
 * (c) `tables` values are fully-qualified `schema.table`; suffixes unique across modules for
 *     `tables`/`queues`/`buckets`
 * (d) soft command-verb prefix uniqueness (reports only in Phase 0)
 *
 * Dynamic check (observer/mutator id cross-check, D4): wired at `registerObserver` /
 * `registerMutator` interception in `boot-modules.ts`. See `ManifestMismatchError`.
 */

import { pathOverlaps, RUNTIME_OWNED_PATHS } from '@server/workspace/workspace-config'
import type { ModuleInstance, WorkspacePath } from './define-module'

export class ManifestCollisionError extends Error {
  constructor(
    public readonly moduleA: string,
    public readonly moduleB: string,
    public readonly reason: string,
  ) {
    super(`manifest collision: "${moduleA}" vs "${moduleB}" — ${reason}`)
    this.name = 'ManifestCollisionError'
  }
}

export class NamespaceViolationError extends Error {
  constructor(
    public readonly moduleName: string,
    public readonly namespace: 'workspace' | 'queue' | 'bucket',
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`namespace violation in "${moduleName}" (${namespace}="${path}"): ${reason}`)
    this.name = 'NamespaceViolationError'
  }
}

export class ManifestMismatchError extends Error {
  constructor(
    public readonly moduleName: string,
    public readonly kind: 'observer' | 'mutator' | 'command',
    public readonly registeredId: string,
    public readonly declaredIds: readonly string[],
  ) {
    super(
      `manifest mismatch in "${moduleName}": registered ${kind} id "${registeredId}" not in ` +
        `manifest.provides.${kind}s [${declaredIds.join(', ')}]`,
    )
    this.name = 'ManifestMismatchError'
  }
}

export class ManifestMalformedError extends Error {
  constructor(
    public readonly moduleName: string,
    public readonly field: string,
    public readonly value: string,
    public readonly reason: string,
  ) {
    super(`manifest malformed in "${moduleName}" (${field}="${value}"): ${reason}`)
    this.name = 'ManifestMalformedError'
  }
}

const TABLE_QUALIFIED_RE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/

/**
 * Runs all static manifest checks. Throws on the first violation; the error
 * surface names the offending module(s) and the specific invariant.
 */
export function validateManifests(modules: readonly ModuleInstance[]): void {
  validateWorkspaceOwnership(modules)
  validateTablesQueuesBuckets(modules)
  validateCommandVerbPrefixes(modules)
}

function validateWorkspaceOwnership(modules: readonly ModuleInstance[]): void {
  const claims: Array<{ moduleName: string; path: WorkspacePath }> = []
  for (const mod of modules) {
    for (const path of mod.manifest.workspace?.owns ?? []) {
      claims.push({ moduleName: mod.name, path })
    }
  }

  for (const claim of claims) {
    for (const runtimePath of RUNTIME_OWNED_PATHS) {
      if (pathOverlaps(runtimePath, claim.path) || pathOverlaps(claim.path, runtimePath)) {
        throw new NamespaceViolationError(
          claim.moduleName,
          'workspace',
          claim.path.path,
          `overlaps runtime-owned path "${runtimePath.path}" (${runtimePath.kind})`,
        )
      }
    }
  }

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i]
      const b = claims[j]
      if (a.moduleName === b.moduleName) continue
      if (pathOverlaps(a.path, b.path) || pathOverlaps(b.path, a.path)) {
        throw new ManifestCollisionError(
          a.moduleName,
          b.moduleName,
          `workspace paths overlap ("${a.path.path}" vs "${b.path.path}")`,
        )
      }
    }
  }
}

function validateTablesQueuesBuckets(modules: readonly ModuleInstance[]): void {
  const tableOwner = new Map<string, string>()
  const queueOwner = new Map<string, string>()
  const bucketOwner = new Map<string, string>()

  for (const mod of modules) {
    for (const table of mod.manifest.tables ?? []) {
      if (!TABLE_QUALIFIED_RE.test(table)) {
        throw new ManifestMalformedError(
          mod.name,
          'tables',
          table,
          'must be fully qualified as "schema.table" (lowercase, underscores)',
        )
      }
      const prev = tableOwner.get(table)
      if (prev && prev !== mod.name) {
        throw new ManifestCollisionError(prev, mod.name, `both claim table "${table}"`)
      }
      tableOwner.set(table, mod.name)
    }
    for (const queue of mod.manifest.queues ?? []) {
      const prev = queueOwner.get(queue)
      if (prev && prev !== mod.name) {
        throw new ManifestCollisionError(prev, mod.name, `both claim queue suffix "${queue}"`)
      }
      queueOwner.set(queue, mod.name)
    }
    for (const bucket of mod.manifest.buckets ?? []) {
      const prev = bucketOwner.get(bucket)
      if (prev && prev !== mod.name) {
        throw new ManifestCollisionError(prev, mod.name, `both claim bucket suffix "${bucket}"`)
      }
      bucketOwner.set(bucket, mod.name)
    }
  }
}

function validateCommandVerbPrefixes(modules: readonly ModuleInstance[]): void {
  const verbOwner = new Map<string, string>()
  for (const mod of modules) {
    for (const cmd of mod.manifest.provides.commands ?? []) {
      const verb = cmd.split(/\s+/)[0] ?? cmd
      const prev = verbOwner.get(verb)
      if (prev && prev !== mod.name) {
        throw new ManifestCollisionError(
          prev,
          mod.name,
          `both claim command verb prefix "${verb}" (declared in manifest.provides.commands)`,
        )
      }
      verbOwner.set(verb, mod.name)
    }
  }
}

/** Cross-check an observer/mutator `id` against the module's manifest. */
export function checkProvidesId(
  moduleName: string,
  kind: 'observer' | 'mutator',
  id: string,
  declared: readonly string[] | undefined,
): void {
  const ids = declared ?? []
  if (!ids.includes(id)) {
    throw new ManifestMismatchError(moduleName, kind, id, ids)
  }
}
