/**
 * Regression test for `searchDrive` query batching.
 *
 * The post-rank phase used to do per-row chunk + per-row file lookups
 * (~2 × N round-trips). It now batches both via `inArray(...)` so a
 * 10-hit search fires exactly two SELECT statements (chunks IN + files IN),
 * regardless of hit count.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import type { DriveFile } from '../schema'
import { createFilesService } from './files'

const ORG = 'org_test_search'

interface SelectCall {
  table: 'chunks' | 'files' | 'unknown'
}

function makeChunkRow(i: number): { id: string; fileId: string; chunkIndex: number; content: string } {
  return {
    id: `chk_${i}`,
    fileId: `f_${i % 3}`, // 10 chunks across 3 distinct files
    chunkIndex: i,
    content: `chunk-${i} content`,
  }
}

function makeFileRow(i: number): DriveFile {
  return {
    id: `f_${i}`,
    organizationId: ORG,
    scope: 'organization',
    scopeId: ORG,
    parentFolderId: null,
    kind: 'file',
    name: `doc-${i}.md`,
    path: `/doc-${i}.md`,
    mimeType: 'text/markdown',
    sizeBytes: 1024,
    storageKey: `org/f_${i}/doc-${i}.md`,
    caption: `caption ${i}`,
    captionModel: 'deterministic-v1',
    captionUpdatedAt: new Date(0),
    extractedText: 'body',
    originalName: `doc-${i}.md`,
    nameStem: `doc-${i}`,
    source: 'staff_uploaded',
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'ready',
    extractionKind: 'extracted',
    processingError: null,
    threatScanReport: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

function makeStubDb(opts: { keywordHits: number }) {
  const selects: SelectCall[] = []
  const executes: Array<{ kind: 'vector' | 'keyword' | 'other' }> = []

  const allChunks = Array.from({ length: opts.keywordHits }, (_, i) => makeChunkRow(i))
  const allFiles = [makeFileRow(0), makeFileRow(1), makeFileRow(2)]

  const db = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        // Tag the next where() call by which table it targets so we can
        // assert exactly two batched lookups (chunks IN + files IN).
        const tableName: SelectCall['table'] =
          table && typeof table === 'object' && 'driveChunks' in (table as object)
            ? 'unknown'
            : (() => {
                // drizzle table objects expose a Symbol-keyed name. Inspect
                // the constructor name as a coarse fallback.
                const name = (table as { _?: { name?: string } } | undefined)?._?.name ?? ''
                if (name.includes('chunk')) return 'chunks'
                if (name.includes('file')) return 'files'
                return 'unknown'
              })()
        return {
          where: (_c: unknown) => {
            selects.push({ table: tableName })
            // Return chunks for the first select call, files for the second.
            // Using order rather than table identity here keeps the stub
            // resilient to drizzle internal field churn.
            const callIndex = selects.length - 1
            if (callIndex === 0) return Promise.resolve(allChunks)
            return Promise.resolve(allFiles)
          },
        }
      },
    }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
    execute: (_q: unknown) => {
      // Vector path is gated by OPENAI_API_KEY; in tests it returns []
      // before the SQL ever fires. So every execute() call here is the
      // keyword tsvector search.
      executes.push({ kind: 'keyword' })
      return Promise.resolve(
        Array.from({ length: opts.keywordHits }, (_, i) => ({ id: `chk_${i}`, rank: 1 - i * 0.01 })),
      )
    },
  }

  return { db, selects, executes }
}

describe('searchDrive — query batching', () => {
  const originalKey = process.env.OPENAI_API_KEY
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
  })
  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalKey
  })

  it('fires exactly 2 SELECT statements (chunks IN + files IN) for a 10-hit search', async () => {
    const stub = makeStubDb({ keywordHits: 10 })
    // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
    const svc = createFilesService({ db: stub.db as any, organizationId: ORG })
    const hits = await svc.searchDrive({ organizationId: ORG, query: 'hello world', limit: 10 })

    // Sanity — we got real hits stitched from chunks + files.
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.path).toMatch(/^\/doc-\d+\.md$/)

    // The post-rank phase MUST be 2 batched IN queries — chunks then files —
    // not 2 × N. Per-rank lookups would push this to ~20 for a 10-hit search.
    expect(stub.selects.length).toBe(2)
  })

  it('returns empty hits without firing post-rank lookups when ranked is empty', async () => {
    const stub = makeStubDb({ keywordHits: 0 })
    // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
    const svc = createFilesService({ db: stub.db as any, organizationId: ORG })
    const hits = await svc.searchDrive({ organizationId: ORG, query: 'no-match', limit: 10 })
    expect(hits).toEqual([])
    expect(stub.selects.length).toBe(0)
  })
})
