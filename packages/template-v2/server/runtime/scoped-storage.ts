/**
 * Namespace-enforced wrapper around a raw `_storage` handle.
 *
 * Modules declare `manifest.buckets: ['attachments']`; the runtime wraps the
 * raw storage with `buildScopedStorage(raw, { moduleName, allowedBuckets })`
 * so `ctx.storage.getBucket('attachments')` resolves but cross-module bucket
 * access throws `NamespaceViolationError`. Modules that do NOT declare
 * buckets pass through unchanged (opt-in during Phase 0).
 */

import type { BucketHandle, ScopedStorage } from '@server/contracts/plugin-context'
import { NamespaceViolationError } from './validate-manifests'

export interface ScopedStorageInput {
  moduleName: string
  /** Allowed bucket suffixes from `manifest.buckets`; undefined = no enforcement. */
  allowedBuckets?: readonly string[]
  raw: ScopedStorage
}

export function buildScopedStorage(input: ScopedStorageInput): ScopedStorage {
  if (input.allowedBuckets === undefined) return input.raw
  const allowed = new Set(input.allowedBuckets)
  const { moduleName, raw } = input

  return {
    getBucket(name: string): BucketHandle {
      if (!allowed.has(name)) {
        throw new NamespaceViolationError(
          moduleName,
          'bucket',
          name,
          `bucket "${name}" not in manifest.buckets [${[...allowed].join(', ')}]`,
        )
      }
      return raw.getBucket(name)
    },
  }
}
