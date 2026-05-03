/**
 * Storage seam for the template runtime.
 *
 * Threads a single `StorageAdapter` instance through every module's `init`
 * via `ctx.storage`. R2 (production) when `R2_BUCKET` + `R2_ACCESS_KEY_ID` +
 * `R2_SECRET_ACCESS_KEY` are all set; local filesystem (dev / tests) otherwise.
 *
 * Modules consume storage via `ctx.storage.bucket(<name>)` — a key-prefix
 * scoped handle (e.g. `bucket('drive').upload('contact/abc/quote.pdf', bytes)`
 * uploads to `drive/contact/abc/quote.pdf` underneath). The raw adapter is
 * exposed for advanced use (presign, list).
 */

import { createLocalAdapter, createS3Adapter, type StorageAdapter, type UploadOptions } from '@vobase/core'

export interface BucketHandle {
  upload(key: string, data: Buffer | Uint8Array, opts?: UploadOptions): Promise<void>
  download(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

export interface AppStorage {
  /** Underlying adapter — used for `presign`, `list`, and tests. */
  readonly raw: StorageAdapter
  /** Returns a key-prefix scoped handle for `<name>/...`. */
  bucket(name: string): BucketHandle
}

export interface StorageEnv {
  R2_BUCKET?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_ENDPOINT?: string
  R2_REGION?: string
  STORAGE_BASE_PATH?: string
}

export function createStorage(env?: StorageEnv): AppStorage {
  const e: Record<string, string | undefined> = (env ?? process.env) as Record<string, string | undefined>
  const r2Bucket = e.R2_BUCKET
  const r2AccessKeyId = e.R2_ACCESS_KEY_ID
  const r2SecretAccessKey = e.R2_SECRET_ACCESS_KEY
  const useR2 = Boolean(r2Bucket && r2AccessKeyId && r2SecretAccessKey)
  const adapter: StorageAdapter = useR2
    ? createS3Adapter({
        type: 's3',
        bucket: r2Bucket as string,
        accessKeyId: r2AccessKeyId as string,
        secretAccessKey: r2SecretAccessKey as string,
        endpoint: e.R2_ENDPOINT,
        region: e.R2_REGION,
      })
    : createLocalAdapter({
        type: 'local',
        basePath: e.STORAGE_BASE_PATH ?? './.data/storage',
      })

  const buckets = new Map<string, BucketHandle>()
  return {
    raw: adapter,
    bucket(name: string): BucketHandle {
      const cached = buckets.get(name)
      if (cached) return cached
      const fullKey = (k: string) => `${name}/${k.replace(/^\/+/, '')}`
      const handle: BucketHandle = {
        upload: (k, d, opts) => adapter.upload(fullKey(k), d, opts),
        download: (k) => adapter.download(fullKey(k)),
        delete: (k) => adapter.delete(fullKey(k)),
        exists: (k) => adapter.exists(fullKey(k)),
      }
      buckets.set(name, handle)
      return handle
    },
  }
}
