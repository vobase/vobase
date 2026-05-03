/**
 * Regression test for `ingestUpload`'s post-storage UPDATE failure cleanup.
 *
 * Pre-fix: if `storage.upload` succeeded but the subsequent UPDATE setting
 * `storageKey` failed, bytes orphaned in the bucket and the row stayed
 * `(pending, pending)` without a `storageKey`. The reaper later flagged it
 * as `no_storage_key` but the bytes leaked.
 *
 * Post-fix: the UPDATE is wrapped in try/catch. On failure the just-uploaded
 * storage object is deleted (best-effort) and the row is marked
 * `(failed, failed)` with `processingError = 'post_storage_update_failed: ${msg}'`.
 */

import { describe, expect, it } from 'bun:test'

import type { DriveFile } from '../schema'
import { createFilesService } from './files'

const ORG = 'org_test_psf'
const FILE_ID = 'f_psf_0'
const SCOPE_ID = 'ctt_test_0'
const ORIGINAL_NAME = 'quote.pdf'

interface DeleteCall {
  bucket: string
  key: string
}

interface UpdatePatch {
  patch: Record<string, unknown>
}

function makeRow(): DriveFile {
  return {
    id: FILE_ID,
    organizationId: ORG,
    scope: 'contact',
    scopeId: SCOPE_ID,
    parentFolderId: null,
    kind: 'file',
    name: 'quote.pdf',
    path: '/quote.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: null,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: null,
    originalName: ORIGINAL_NAME,
    nameStem: 'quote',
    source: 'customer_inbound',
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'pending',
    extractionKind: 'pending',
    processingError: null,
    threatScanReport: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

function makeStubs() {
  let updateCalls = 0
  const updates: UpdatePatch[] = []
  const deletes: DeleteCall[] = []
  const uploads: Array<{ key: string }> = []

  const row = makeRow()

  const db = {
    select: () => ({
      from: () => {
        const handler = {
          where: () => {
            const limitable = {
              limit: () => Promise.resolve([]),
            }
            return Object.assign(Promise.resolve([] as unknown[]), limitable)
          },
        }
        return Object.assign(handler, Promise.resolve([] as unknown[]))
      },
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([row]),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          updateCalls += 1
          // First UPDATE = setting storageKey → fail.
          // Second UPDATE = the cleanup (failed, failed, error) → succeed.
          if (updateCalls === 1 && 'storageKey' in v && !('processingStatus' in v)) {
            return Promise.reject(new Error('relation drive.files violates check constraint'))
          }
          updates.push({ patch: v })
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
    execute: () => Promise.resolve([] as unknown[]),
  }

  const storage = {
    raw: {} as never,
    bucket: (name: string) => ({
      upload: (key: string) => {
        uploads.push({ key })
        return Promise.resolve()
      },
      download: () => Promise.resolve(new Uint8Array()),
      delete: (key: string) => {
        deletes.push({ bucket: name, key })
        return Promise.resolve()
      },
      exists: () => Promise.resolve(true),
    }),
  }

  const jobs = {
    send: () => Promise.resolve('job-1'),
  }

  const realtime = {
    notify: () => undefined,
    subscribe: () => () => undefined,
  }

  return { db, storage, jobs, realtime, updates, deletes, uploads, row }
}

describe('ingestUpload — post-storage UPDATE failure cleanup', () => {
  it('deletes orphan bytes and marks row (failed, failed) when storageKey UPDATE throws', async () => {
    const stubs = makeStubs()
    const svc = createFilesService({
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      db: stubs.db as any,
      organizationId: ORG,
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      storage: stubs.storage as any,
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      jobs: stubs.jobs as any,
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      realtime: stubs.realtime as any,
    })

    let thrown: unknown = null
    try {
      await svc.ingestUpload({
        organizationId: ORG,
        scope: { scope: 'contact', contactId: SCOPE_ID },
        originalName: ORIGINAL_NAME,
        mimeType: 'application/pdf',
        sizeBytes: 4,
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        source: 'customer_inbound',
        uploadedBy: null,
        basePath: '/',
      })
    } catch (err) {
      thrown = err
    }

    // The post-storage UPDATE failure must surface as a thrown error to the caller.
    expect(thrown).toBeInstanceOf(Error)

    // 1. Upload happened first.
    expect(stubs.uploads.length).toBe(1)
    const expectedKey = stubs.uploads[0]?.key
    expect(expectedKey).toBeDefined()

    // 2. The failed UPDATE triggered a storage.delete with the SAME key — no orphan.
    expect(stubs.deletes.length).toBe(1)
    expect(stubs.deletes[0]?.key).toBe(expectedKey ?? '')

    // 3. Row marked (failed, failed) with post_storage_update_failed prefix.
    const cleanupPatch = stubs.updates[0]?.patch ?? {}
    expect(cleanupPatch.processingStatus).toBe('failed')
    expect(cleanupPatch.extractionKind).toBe('failed')
    expect(String(cleanupPatch.processingError ?? '')).toMatch(/^post_storage_update_failed: /)
  })
})
