/**
 * Regression test for `processFileJobHandler` bulk-inserting drive chunks.
 *
 * The pre-fix loop did `db.insert(driveChunks).values({...})` once per
 * chunk. For an N-chunk doc that's N round-trips. The current path passes
 * the whole array to `.values([...])` so the insert call count is exactly
 * one for the chunks table regardless of chunk count.
 */

import { describe, expect, it, mock } from 'bun:test'
import { driveChunks } from '@modules/drive/schema'

import type { DriveFile } from './schema'

// Stub embeddings BEFORE jobs.ts loads its `from './lib/embeddings'` import,
// so the bulk-INSERT path runs without OPENAI_API_KEY. Dynamic import of
// `./jobs` below ensures the mock is registered first.
mock.module('./lib/embeddings', () => ({
  embedTexts: (texts: string[]) =>
    Promise.resolve({
      embeddings: texts.map(() => new Array(1536).fill(0) as number[]),
      tokensUsed: texts.length * 100,
    }),
  encodeVector: (v: number[]) => `[${v.join(',')}]`,
}))

// biome-ignore lint/plugin/no-dynamic-import: test mocking — must register the embeddings mock BEFORE jobs.ts evaluates its static import.
const { processFileJobHandler } = await import('./jobs')

const ORG = 'org_test_bulk'
const FILE_ID = 'f_bulk_0'

function makeRow(partial: Partial<DriveFile> = {}): DriveFile {
  return {
    id: FILE_ID,
    organizationId: ORG,
    scope: 'organization',
    scopeId: ORG,
    parentFolderId: null,
    kind: 'file',
    name: 'big.md',
    path: '/big.md',
    mimeType: 'text/markdown',
    sizeBytes: 16_000,
    storageKey: `org/${FILE_ID}/big.md`,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: null,
    originalName: 'big.md',
    nameStem: 'big',
    source: 'staff_uploaded',
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'pending',
    extractionKind: 'pending',
    processingError: null,
    threatScanReport: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  }
}

interface InsertCall {
  table: 'driveChunks' | 'other'
  rowCount: number
}

function makeStubs(rows: DriveFile[], bytes: Uint8Array) {
  const inserts: InsertCall[] = []
  const sets: Array<Record<string, unknown>> = []

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows.slice()),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        const isChunks = table === driveChunks
        const rowCount = Array.isArray(v) ? v.length : 1
        inserts.push({ table: isChunks ? 'driveChunks' : 'other', rowCount })
        const result: Promise<undefined> & { onConflictDoUpdate?: (cfg: unknown) => Promise<undefined> } =
          Promise.resolve(undefined)
        result.onConflictDoUpdate = (_cfg: unknown) => Promise.resolve(undefined)
        return result
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          sets.push(v)
          const head = rows[0]
          if (head) Object.assign(head, v)
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
    execute: () => Promise.resolve([] as unknown[]),
  }

  const storage = {
    raw: {} as never,
    bucket: () => ({
      upload: () => Promise.resolve(),
      download: () => Promise.resolve(bytes),
      delete: () => Promise.resolve(),
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

  return { db, storage, jobs, realtime, inserts }
}

describe('processFileJobHandler — bulk chunk insert', () => {
  it('fires exactly one insert into driveChunks for an N-chunk markdown doc', async () => {
    // ~64 KB markdown spread across many CHUNK_TARGET-sized blocks. The
    // chunker yields one chunk per ~512-token block; whatever N falls out,
    // a single bulk INSERT must carry the whole array.
    const oneChunk = `${'lorem ipsum dolor sit amet '.repeat(80)}\n\n`
    const markdown = oneChunk.repeat(20)
    const rows = [makeRow()]
    const stubs = makeStubs(rows, new TextEncoder().encode(markdown))

    const result = await processFileJobHandler(
      { fileId: FILE_ID, organizationId: ORG },
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      { db: stubs.db as any, storage: stubs.storage as any, jobs: stubs.jobs as any, realtime: stubs.realtime as any },
    )
    expect(result.kind).toBe('extracted')

    // Exactly one INSERT into drive.chunks. The cost-usage upsert hits a
    // different table so it must not be counted.
    const chunkInserts = stubs.inserts.filter((c) => c.table === 'driveChunks')
    expect(chunkInserts.length).toBe(1)
    // And that single call carried > 1 chunk — proves the row-by-row loop
    // is gone (the loop case would split chunks across N calls).
    expect(chunkInserts[0]?.rowCount).toBeGreaterThan(1)
  })
})
