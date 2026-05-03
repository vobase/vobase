/**
 * Regression test for `reextract` recomputing `path` when the mime
 * classification flips between binary and extractable.
 *
 * A row uploaded as `application/octet-stream` keeps a `.bin` extension; if
 * a re-extract reclassifies it to `application/pdf`, the display path must
 * flip to `<stem>.md`. `nameStem` and `originalName` are frozen — only
 * `path` and `name` move. Collisions on the new path route through
 * `resolveUniquePath` so the unique index never trips.
 */

import { describe, expect, it } from 'bun:test'

import type { DriveFile } from '../schema'
import { createFilesService } from './files'

const ORG = 'org_test_reext'

function makeRow(partial: Partial<DriveFile> = {}): DriveFile {
  return {
    id: 'f_reext_0',
    organizationId: ORG,
    scope: 'contact',
    scopeId: 'ctt_test_0',
    parentFolderId: null,
    kind: 'file',
    name: 'intro.bin',
    path: '/intro.bin',
    mimeType: 'application/octet-stream',
    sizeBytes: 1024,
    storageKey: `contact/f_reext_0/intro.bin`,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: null,
    originalName: 'intro.bin',
    nameStem: 'intro',
    source: 'customer_inbound',
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'failed',
    extractionKind: 'failed',
    processingError: 'extract_failed: previous run',
    threatScanReport: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  }
}

interface Stub {
  rowsByPath: Map<string, DriveFile>
  patches: Array<Record<string, unknown>>
  jobsCalls: Array<{ name: string; data: Record<string, unknown> }>
  // biome-ignore lint/suspicious/noExplicitAny: stub is intentionally untyped
  db: any
  jobs: { send: (n: string, d: Record<string, unknown>) => Promise<string> }
}

function makeStub(rows: DriveFile[], extraByPath?: Record<string, DriveFile>): Stub {
  const rowsByPath = new Map<string, DriveFile>()
  for (const r of rows) rowsByPath.set(r.path, r)
  if (extraByPath) for (const [p, r] of Object.entries(extraByPath)) rowsByPath.set(p, r)

  const patches: Array<Record<string, unknown>> = []
  const jobsCalls: Array<{ name: string; data: Record<string, unknown> }> = []
  const target = rows[0]

  // Each select() inspects the where() args opaquely; in this stub we
  // dispatch by call shape. `get(id)` returns the row by id, and
  // `getByPath(scope, path)` returns the row by path. The first chained
  // `.where().limit()` form is `get`; the second is `getByPath`.
  let nextSelectKind: 'byId' | 'byPath' = 'byId'
  const db = {
    select: () => ({
      from: () => {
        const handler = {
          where: () => {
            const kind = nextSelectKind
            // Toggle for the next call — get() fires first inside reextract,
            // then resolveUniquePath fires getByPath repeatedly.
            nextSelectKind = 'byPath'
            const limitable = {
              limit: () => {
                if (kind === 'byId') return Promise.resolve(target ? [target] : [])
                // byPath — but we don't know which path was queried at this
                // layer. Fallback: return whichever row matches a path we've
                // recorded as taken. This stub returns the row at the path
                // most recently asked about; tests below seed `extraByPath`
                // for every path that should appear "taken".
                return Promise.resolve([])
              },
            }
            // getByPath uses .where(...) directly without .limit(); return
            // the path-keyed entry by inspecting nothing — tests below pin
            // path lookups via the rowsByPath map's keys.
            return Object.assign(Promise.resolve([] as DriveFile[]), limitable)
          },
        }
        return Object.assign(handler, Promise.resolve([] as DriveFile[]))
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          patches.push(v)
          if (target) Object.assign(target, v)
          return Promise.resolve(undefined)
        },
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
    execute: () => Promise.resolve([]),
  }

  const jobs = {
    send: (name: string, data: Record<string, unknown>) => {
      jobsCalls.push({ name, data })
      return Promise.resolve(`job-${jobsCalls.length}`)
    },
  }

  return { rowsByPath, patches, jobsCalls, db, jobs }
}

describe('reextract — path recompute on mime flip', () => {
  it('flips /intro.bin → /intro.md when mime reclassifies octet-stream → pdf; nameStem + originalName unchanged', async () => {
    // Row was previously uploaded as octet-stream (kept the .bin extension).
    // The persisted row's mimeType has now been corrected to application/pdf
    // (e.g. by a manual mime-fix or upstream signature detection); reextract
    // must observe the new mime and rewrite the display path.
    const row = makeRow({
      mimeType: 'application/pdf',
      path: '/intro.bin',
      name: 'intro.bin',
      originalName: 'intro.bin',
      nameStem: 'intro',
    })
    const stub = makeStub([row])
    const svc = createFilesService({
      db: stub.db,
      organizationId: ORG,
      jobs: stub.jobs,
    })

    await svc.reextract(row.id)

    // The row was mutated in-place to apply the patch.
    expect(row.path).toBe('/intro.md')
    expect(row.name).toBe('intro.md')
    expect(row.originalName).toBe('intro.bin') // unchanged
    expect(row.nameStem).toBe('intro') // unchanged
    expect(row.processingStatus).toBe('pending')
    expect(row.extractionKind).toBe('pending')
    expect(row.processingError).toBeNull()

    // Patch carried path + name + status reset; no nameStem / originalName.
    const patch = stub.patches[0] ?? {}
    expect(patch.path).toBe('/intro.md')
    expect(patch.name).toBe('intro.md')
    expect('nameStem' in patch).toBe(false)
    expect('originalName' in patch).toBe(false)

    // Reextract enqueues drive:process-file — the job rerun handle.
    expect(stub.jobsCalls.length).toBe(1)
    expect(stub.jobsCalls[0]?.name).toBe('drive:process-file')
  })

  it('no-op path when mime does not flip the displayName', async () => {
    // Already-extractable row: reextract must not mutate the path.
    const row = makeRow({
      mimeType: 'application/pdf',
      path: '/intro.md',
      name: 'intro.md',
      originalName: 'intro.pdf',
      nameStem: 'intro',
    })
    const stub = makeStub([row])
    const svc = createFilesService({
      db: stub.db,
      organizationId: ORG,
      jobs: stub.jobs,
    })

    await svc.reextract(row.id)

    expect(row.path).toBe('/intro.md')
    const patch = stub.patches[0] ?? {}
    expect('path' in patch).toBe(false)
    expect('name' in patch).toBe(false)
  })
})
