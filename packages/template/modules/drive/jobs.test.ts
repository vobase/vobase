/**
 * Unit tests for the drive `processFileJobHandler`. Stubs db / storage / jobs
 * / realtime so the test runs in-memory without Docker. Only verifies branch
 * behaviour around state transitions, the binary-stub→stub-content path, and
 * the `forceCaption` → `AGENTS_WAKE_JOB` enqueue with the
 * `caption_ready` trigger payload (Step 5 acceptance).
 */

import { describe, expect, it } from 'bun:test'

import { AGENTS_WAKE_JOB } from '~/wake/inbound'
import { processFileJobHandler } from './jobs'
import type { DriveFile } from './schema'

const ORG = 'org_test_0'
const FILE_ID = 'f_drive_0'

function makeRow(partial: Partial<DriveFile> = {}): DriveFile {
  return {
    id: FILE_ID,
    organizationId: ORG,
    scope: 'contact',
    scopeId: 'ctt_test_0',
    parentFolderId: null,
    kind: 'file',
    name: 'intro.mp4',
    path: '/contacts/ctt_test_0/intro.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    storageKey: `contact/${FILE_ID}/intro.mp4`,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: null,
    originalName: 'intro.mp4',
    nameStem: 'intro',
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
    ...partial,
  }
}

interface JobsCall {
  name: string
  data: Record<string, unknown>
  opts?: { singletonKey?: string }
}

function makeStubs(rows: DriveFile[], bytes: Uint8Array) {
  const sets: Array<Record<string, unknown>> = []
  const inserts: Array<Record<string, unknown>> = []
  const deletes: number[] = []
  const jobsCalls: JobsCall[] = []
  const realtimeCalls: Array<{ table: string; id?: string; action?: string }> = []

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows.slice()),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (Array.isArray(v)) inserts.push(...v)
        else inserts.push(v)
        // budget.recordUsage() chains .onConflictDoUpdate after .values
        const result: Promise<undefined> & { onConflictDoUpdate?: (cfg: unknown) => Promise<undefined> } =
          Promise.resolve(undefined)
        result.onConflictDoUpdate = (_cfg: unknown) => Promise.resolve(undefined)
        return result
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (_c: unknown) => {
          sets.push(v)
          // Apply patch to first row so subsequent reads see the latest state.
          const head = rows[0]
          if (head) Object.assign(head, v)
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: () => ({
      where: () => {
        deletes.push(Date.now())
        return Promise.resolve(undefined)
      },
    }),
    // budget.getTodayUsage() reads via raw SQL execute. Empty result → no
    // usage today → budget gate passes.
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
    send: (name: string, data: Record<string, unknown>, opts?: { singletonKey?: string }) => {
      jobsCalls.push({ name, data, opts })
      return Promise.resolve(`job-${jobsCalls.length}`)
    },
  }

  const realtime = {
    notify: (payload: { table: string; id?: string; action?: string }) => {
      realtimeCalls.push(payload)
    },
    subscribe: () => () => undefined,
  }

  return { db, storage, jobs, realtime, sets, inserts, deletes, jobsCalls, realtimeCalls }
}

describe('processFileJobHandler', () => {
  it('binary-stub: writes stub markdown + flips to (binary-stub, ready)', async () => {
    const rows = [makeRow()]
    const stubs = makeStubs(rows, new Uint8Array([0, 1, 2, 3]))
    const result = await processFileJobHandler(
      { fileId: FILE_ID, organizationId: ORG },
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      { db: stubs.db as any, storage: stubs.storage as any, jobs: stubs.jobs as any, realtime: stubs.realtime as any },
    )
    expect(result.kind).toBe('binary-stub')
    const final = rows[0]
    expect(final?.extractionKind).toBe('binary-stub')
    expect(final?.processingStatus).toBe('ready')
    expect(final?.extractedText ?? '').toContain('binary-file')
    expect(final?.caption ?? '').toContain('MP4 video')
  })

  it('forceCaption on binary-stub row: extracts via OCR + enqueues caption_ready wake', async () => {
    // Row currently a binary-stub (e.g. an .mp4 inbound attachment). Agent
    // calls request_caption → service enqueues the job with forceCaption=true
    // + wakeOnComplete. The job runs OCR (stubbed below to return a small
    // image-extract path) and then enqueues AGENTS_WAKE_JOB with the
    // caption_ready trigger.
    const rows = [
      makeRow({
        extractionKind: 'binary-stub',
        processingStatus: 'ready',
        extractedText: 'old stub',
        mimeType: 'image/png',
        path: '/contacts/ctt_test_0/snap.png',
        originalName: 'snap.png',
      }),
    ]
    const stubs = makeStubs(rows, new Uint8Array([0x89, 0x50, 0x4e, 0x47])) // \x89PNG
    const stubOcr = (_b: Uint8Array | Buffer, _m: string) =>
      Promise.resolve({ summary: 'a snapshot of a graph', text: 'verbatim text from image' })
    const result = await processFileJobHandler(
      {
        fileId: FILE_ID,
        organizationId: ORG,
        forceCaption: true,
        wakeOnComplete: { conversationId: 'conv_0', contactId: 'ctt_test_0' },
      },
      {
        // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
        db: stubs.db as any,
        // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
        storage: stubs.storage as any,
        // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
        jobs: stubs.jobs as any,
        // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
        realtime: stubs.realtime as any,
        ocr: stubOcr,
      },
    )
    expect(result.kind === 'extracted' || result.kind === 'binary-stub').toBe(true)
    // The wake-job assertion is the headline — it should be in jobsCalls.
    const captionWake = stubs.jobsCalls.find((c) => c.name === AGENTS_WAKE_JOB)
    expect(captionWake).toBeDefined()
    if (captionWake) {
      const trigger = captionWake.data.trigger as
        | { trigger: string; conversationId: string; fileId: string }
        | undefined
      expect(trigger?.trigger).toBe('caption_ready')
      expect(trigger?.conversationId).toBe('conv_0')
      expect(trigger?.fileId).toBe(FILE_ID)
      expect(captionWake.data.contactId).toBe('ctt_test_0')
      expect(captionWake.data.organizationId).toBe(ORG)
      expect(captionWake.opts?.singletonKey).toBe(`drive:caption-ready:${FILE_ID}`)
    }
  })

  it('idempotent re-run: row not in pending state is a noop', async () => {
    const rows = [makeRow({ processingStatus: 'ready', extractionKind: 'extracted' })]
    const stubs = makeStubs(rows, new Uint8Array([0]))
    const result = await processFileJobHandler(
      { fileId: FILE_ID, organizationId: ORG },
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      { db: stubs.db as any, storage: stubs.storage as any, jobs: stubs.jobs as any, realtime: stubs.realtime as any },
    )
    expect(result.kind).toBe('noop')
    expect(stubs.deletes.length).toBe(0)
  })

  it('row missing storageKey: marks failed', async () => {
    const rows = [makeRow({ storageKey: null })]
    const stubs = makeStubs(rows, new Uint8Array([0]))
    const result = await processFileJobHandler(
      { fileId: FILE_ID, organizationId: ORG },
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      { db: stubs.db as any, storage: stubs.storage as any, jobs: stubs.jobs as any, realtime: stubs.realtime as any },
    )
    expect(result.kind).toBe('failed')
    expect(rows[0]?.extractionKind).toBe('failed')
    expect(rows[0]?.processingError).toBe('no_storage_key')
  })

  it('budget gate: over-cap usage rejects with org_daily_budget_exceeded', async () => {
    const rows = [makeRow({ mimeType: 'application/pdf' })]
    const stubs = makeStubs(rows, new Uint8Array([0x25, 0x50, 0x44, 0x46])) // %PDF
    // Saturate OCR cap so projectBudget(row, false) trips the gate.
    const saturated = [
      {
        llm_task: 'drive.extract.pdf',
        call_count: 999_999,
        tokens_in: 0,
        tokens_out: 0,
      },
    ]
    // Override db.execute to return saturated usage.
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    ;(stubs.db as any).execute = () => Promise.resolve(saturated)
    const result = await processFileJobHandler(
      { fileId: FILE_ID, organizationId: ORG },
      // biome-ignore lint/suspicious/noExplicitAny: stub injection for unit test
      { db: stubs.db as any, storage: stubs.storage as any, jobs: stubs.jobs as any, realtime: stubs.realtime as any },
    )
    expect(result.kind).toBe('failed')
    expect(rows[0]?.extractionKind).toBe('failed')
    expect(rows[0]?.processingError).toBe('org_daily_budget_exceeded')
    // No paid call should have fired — chunk delete also should not have run.
    expect(stubs.deletes.length).toBe(0)
  })
})
