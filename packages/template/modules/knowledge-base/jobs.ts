import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StorageService, VobaseDb } from '@vobase/core'
import { defineJob } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { KB_STORAGE_BUCKET } from './constants'
import { extractDocument } from './lib/extract'
import { processDocument } from './lib/pipeline'
import { kbDocuments } from './schema'

let moduleDb: VobaseDb
let moduleStorage: StorageService

/** Called from the module init hook to wire up the db reference. */
export function setModuleDb(db: VobaseDb) {
  moduleDb = db
}

/** Called from the module init hook to wire up the storage reference. */
export function setModuleStorage(storage: StorageService) {
  moduleStorage = storage
}

export const processDocumentJob = defineJob('knowledge-base:process-document', async (data) => {
  if (!moduleDb) {
    throw new Error('moduleDb not initialized — init() has not run yet')
  }
  if (!moduleStorage) {
    throw new Error('moduleStorage not initialized — init() has not run yet')
  }

  const { documentId, storageKey, mimeType } = data as {
    documentId: string
    storageKey: string
    mimeType: string
  }

  // Download file from storage to a local temp file for extraction
  const buffer = await moduleStorage.bucket(KB_STORAGE_BUCKET).download(storageKey)
  const fileName = storageKey.split('/').pop() ?? documentId
  const tmpPath = join(tmpdir(), fileName)
  await Bun.write(tmpPath, buffer)

  try {
    // 1. Extract text from the temp file
    const result = await extractDocument(tmpPath, mimeType)

    // 2. Handle needs_ocr status
    if (result.status === 'needs_ocr') {
      await moduleDb
        .update(kbDocuments)
        .set({
          status: 'needs_ocr',
          metadata: JSON.stringify({ warning: result.warning }),
        })
        .where(eq(kbDocuments.id, documentId))
      return
    }

    // 3. Process document (chunk + embed + store)
    await processDocument(moduleDb, documentId, result.value, result.rawValue)
  } finally {
    // 4. Clean up local temp file
    try {
      unlinkSync(tmpPath)
    } catch {
      // File may already be deleted — ignore
    }
  }
})
