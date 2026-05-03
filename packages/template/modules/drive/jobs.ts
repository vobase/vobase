/**
 * `drive:process-file` job — extraction + chunk + embed pipeline.
 *
 * Producer: `ingestUpload` / `requestCaption` / `reextract` / the reaper.
 * Payload: `{ fileId, organizationId, forceCaption?, wakeOnComplete? }`.
 */

import { driveChunks, driveFiles } from '@modules/drive/schema'
import { type JobDef, recordCostUsage } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import type { AppStorage, LlmTask, RealtimeService } from '~/runtime'
import { AGENTS_WAKE_JOB } from '~/wake/inbound'
import { DRIVE_PROCESS_FILE_JOB, DRIVE_STORAGE_BUCKET, MAX_CHUNKS_PER_FILE } from './constants'
import { type DriveCaptionKind, deriveCaption } from './lib/caption'
import { chunkMarkdown } from './lib/chunker'
import { embedTexts, encodeVector } from './lib/embeddings'
import { extract } from './lib/extract'
import { ocrImage } from './lib/ocr-provider'
import type { DriveFile } from './schema'
import { checkBudget, EMBED_TASK } from './service/budget'

export interface ProcessFilePayload {
  fileId: string
  organizationId: string
  forceCaption?: boolean
  wakeOnComplete?: { conversationId: string; contactId: string }
}

export interface JobDeps {
  db: unknown
  storage: AppStorage
  jobs: { send(name: string, data: Record<string, unknown>, opts?: { singletonKey?: string }): Promise<string> }
  realtime: RealtimeService | null
  /** Test-injected stub; defaults to live `ocrImage`. */
  ocr?: (buffer: Buffer | Uint8Array, mime: string) => Promise<{ summary: string; text: string }>
}

type DriveDb = {
  select: (cols?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => Promise<unknown[]>
    }
  }
  insert: (t: unknown) => {
    values: (v: unknown) => Promise<unknown> & {
      onConflictDoUpdate?: (cfg: unknown) => Promise<unknown>
    }
  }
  update: (t: unknown) => {
    set: (v: unknown) => {
      where: (c: unknown) => Promise<unknown>
    }
  }
  delete: (t: unknown) => {
    where: (c: unknown) => Promise<unknown>
  }
  execute: <T>(q: unknown) => Promise<T[]>
}

function notifyDriveFile(
  realtime: RealtimeService | null,
  id: string,
  action: 'created' | 'updated' | 'deleted',
): void {
  realtime?.notify({ table: 'drive_files', id, action })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function loadRow(db: DriveDb, organizationId: string, fileId: string): Promise<DriveFile | null> {
  const rows = (await db
    .select()
    .from(driveFiles)
    .where(and(eq(driveFiles.organizationId, organizationId), eq(driveFiles.id, fileId)))) as DriveFile[]
  return rows[0] ?? null
}

async function setRowState(
  db: DriveDb,
  organizationId: string,
  fileId: string,
  patch: Partial<DriveFile>,
): Promise<void> {
  await db
    .update(driveFiles)
    .set(patch)
    .where(and(eq(driveFiles.organizationId, organizationId), eq(driveFiles.id, fileId)))
}

async function markFailed(
  db: DriveDb,
  realtime: RealtimeService | null,
  organizationId: string,
  fileId: string,
  processingError: string,
): Promise<void> {
  await setRowState(db, organizationId, fileId, {
    processingStatus: 'failed',
    extractionKind: 'failed',
    processingError,
  })
  notifyDriveFile(realtime, fileId, 'updated')
}

/**
 * Project the upcoming paid call cost. Size-based: file content scaled at
 * 1 token per 4 chars (the standard chat-tokenizer ratio), bounded by the
 * `MAX_CHUNKS_PER_FILE * 512` ceiling. Over-projecting kills small uploads
 * (~5 per day exhaust the cap); under-projecting lets a single huge file
 * blow past the cap. Charge OCR only when the mime requires multimodal.
 */
function projectBudget(row: DriveFile, isForceCaption: boolean): { ocrPages: number; embedTokens: number } {
  const mime = row.mimeType ?? ''
  const willOcr = isForceCaption || mime.startsWith('image/') || mime === 'application/pdf'
  const sizeBased = Math.ceil((row.sizeBytes ?? 0) / 4)
  const cap = MAX_CHUNKS_PER_FILE * 512
  return { ocrPages: willOcr ? 1 : 0, embedTokens: Math.min(sizeBased, cap) }
}

const today = (): string => new Date().toISOString().slice(0, 10)

export async function processFileJobHandler(
  payload: ProcessFilePayload,
  deps: JobDeps,
): Promise<{ kind: 'noop' | 'extracted' | 'binary-stub' | 'failed' }> {
  const db = deps.db as DriveDb
  const orgId = payload.organizationId
  const row = await loadRow(db, orgId, payload.fileId)
  if (!row) return { kind: 'noop' }

  const isForceCaption = Boolean(payload.forceCaption)

  if (!isForceCaption && row.processingStatus !== 'pending') return { kind: 'noop' }
  // forceCaption only flips a binary-stub; an extracted/pending/failed row needs reextract instead.
  if (isForceCaption && row.extractionKind !== 'binary-stub') return { kind: 'noop' }

  // Per-org daily budget gate (Principle 10). Reject before any paid call.
  const budget = await checkBudget(db, orgId, projectBudget(row, isForceCaption))
  if (!budget.ok) {
    await markFailed(db, deps.realtime, orgId, row.id, budget.reason)
    if (isForceCaption && payload.wakeOnComplete) await enqueueCaptionReadyWake(deps, payload, row.id)
    return { kind: 'failed' }
  }

  await db.delete(driveChunks).where(and(eq(driveChunks.organizationId, orgId), eq(driveChunks.fileId, row.id)))
  await setRowState(db, orgId, row.id, { processingStatus: 'processing' })
  notifyDriveFile(deps.realtime, row.id, 'updated')

  if (!row.storageKey) {
    await markFailed(db, deps.realtime, orgId, row.id, 'no_storage_key')
    return { kind: 'failed' }
  }

  let bytes: Uint8Array
  try {
    bytes = await deps.storage.bucket(DRIVE_STORAGE_BUCKET).download(row.storageKey)
  } catch (err) {
    await markFailed(db, deps.realtime, orgId, row.id, `storage_download_failed: ${errMessage(err)}`)
    return { kind: 'failed' }
  }

  const ocr = deps.ocr ?? ocrImage
  const result = await extract({
    bytes,
    mimeType: row.mimeType ?? 'application/octet-stream',
    originalName: row.originalName ?? row.name,
    stub: {
      mimeType: row.mimeType ?? 'application/octet-stream',
      sizeBytes: row.sizeBytes ?? bytes.length,
      name: row.originalName ?? row.name,
      path: row.path,
      storageKey: row.storageKey,
    },
    ocr,
  })

  if (result.kind === 'failed') {
    await markFailed(db, deps.realtime, orgId, row.id, `extract_failed: ${result.error}`)
    return { kind: 'failed' }
  }

  if (result.kind === 'binary-stub') {
    const captionKind: DriveCaptionKind = 'binary-stub'
    const caption = deriveCaption({
      kind: captionKind,
      mimeType: row.mimeType ?? 'application/octet-stream',
      sizeBytes: row.sizeBytes ?? bytes.length,
    })
    await setRowState(db, orgId, row.id, {
      extractedText: result.markdown,
      caption,
      captionModel: 'deterministic-v1',
      captionUpdatedAt: new Date(),
      extractionKind: 'binary-stub',
      processingStatus: 'ready',
      processingError: null,
    })
    notifyDriveFile(deps.realtime, row.id, 'updated')
    return { kind: 'binary-stub' }
  }

  const captionKind: DriveCaptionKind = 'extracted'
  const caption = deriveCaption({
    kind: captionKind,
    extractedText: result.markdown,
    mimeType: row.mimeType ?? 'application/octet-stream',
    sizeBytes: row.sizeBytes ?? bytes.length,
    ocrSummary: result.ocrSummary,
  })

  const allChunks = chunkMarkdown(result.markdown)
  const truncated = allChunks.length > MAX_CHUNKS_PER_FILE
  const usableChunks = truncated ? allChunks.slice(0, MAX_CHUNKS_PER_FILE) : allChunks
  const processingError: string | null = truncated ? 'truncated_at_chunk_cap' : null

  if (usableChunks.length > 0) {
    try {
      const { embeddings } = await embedTexts(usableChunks.map((c) => c.content))
      const chunkRows = usableChunks.map((c, i) => ({
        organizationId: orgId,
        scope: row.scope,
        scopeId: row.scopeId,
        fileId: row.id,
        chunkIndex: c.index,
        content: c.content,
        embedding: embeddings[i] ? encodeVector(embeddings[i] as number[]) : null,
        tokenCount: c.tokenCount,
      }))
      await db.insert(driveChunks).values(chunkRows)
      const totalTokens = usableChunks.reduce((s, c) => s + c.tokenCount, 0)
      await recordCostUsage({
        organizationId: orgId,
        date: today(),
        llmTask: EMBED_TASK,
        tokensIn: totalTokens,
        tokensOut: 0,
        cacheReadTokens: 0,
        costUsd: 0,
      })
      if (result.ocrSummary) {
        const ocrTask: LlmTask = (row.mimeType ?? '').startsWith('image/') ? 'drive.caption.image' : 'drive.extract.pdf'
        await recordCostUsage({
          organizationId: orgId,
          date: today(),
          llmTask: ocrTask,
          tokensIn: 0,
          tokensOut: 0,
          cacheReadTokens: 0,
          costUsd: 0,
        })
      }
    } catch (err) {
      await setRowState(db, orgId, row.id, {
        extractedText: result.markdown,
        caption,
        captionModel: 'deterministic-v1',
        captionUpdatedAt: new Date(),
        extractionKind: 'extracted',
        processingStatus: 'failed',
        processingError: `embedding_unavailable: ${errMessage(err)}`,
      })
      notifyDriveFile(deps.realtime, row.id, 'updated')
      if (isForceCaption && payload.wakeOnComplete) await enqueueCaptionReadyWake(deps, payload, row.id)
      return { kind: 'extracted' }
    }
  }

  await setRowState(db, orgId, row.id, {
    extractedText: result.markdown,
    caption,
    captionModel: 'deterministic-v1',
    captionUpdatedAt: new Date(),
    extractionKind: 'extracted',
    processingStatus: 'ready',
    processingError,
  })
  notifyDriveFile(deps.realtime, row.id, 'updated')

  if (isForceCaption && payload.wakeOnComplete) await enqueueCaptionReadyWake(deps, payload, row.id)
  return { kind: 'extracted' }
}

async function enqueueCaptionReadyWake(deps: JobDeps, payload: ProcessFilePayload, fileId: string): Promise<void> {
  const wake = payload.wakeOnComplete
  if (!wake) return
  // Producer-side trigger discriminator; the WakeTrigger union is the single
  // source of truth for the conversation-lane wake bus.
  await deps.jobs.send(
    AGENTS_WAKE_JOB,
    {
      organizationId: payload.organizationId,
      conversationId: wake.conversationId,
      contactId: wake.contactId,
      trigger: { trigger: 'caption_ready', conversationId: wake.conversationId, fileId },
    },
    { singletonKey: `drive:caption-ready:${fileId}` },
  )
}

let _currentDeps: JobDeps | null = null

export function setJobDeps(deps: JobDeps): void {
  _currentDeps = deps
}

export function __resetJobDepsForTests(): void {
  _currentDeps = null
}

export const jobs: JobDef[] = [
  {
    name: DRIVE_PROCESS_FILE_JOB,
    handler: async (data) => {
      if (!_currentDeps) {
        console.warn('[drive] process-file job fired before deps installed; skipping')
        return
      }
      await processFileJobHandler(data as ProcessFilePayload, _currentDeps)
    },
  },
]
