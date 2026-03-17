import { unlinkSync } from 'node:fs';
import type { VobaseDb } from '@vobase/core';
import { defineJob } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { kbDocuments } from './schema';

let moduleDb: VobaseDb;

/** Called from the module init hook to wire up the db reference. */
export function setModuleDb(db: VobaseDb) {
  moduleDb = db;
}

export const processDocumentJob = defineJob(
  'knowledge-base:process-document',
  async (data) => {
    if (!moduleDb) {
      throw new Error('moduleDb not initialized — init() has not run yet');
    }

    const { documentId, filePath, mimeType } = data as {
      documentId: string;
      filePath: string;
      mimeType: string;
    };

    try {
      // 1. Extract text from the temp file
      const { extractDocument } = await import('./lib/extract');
      const result = await extractDocument(filePath, mimeType);

      // 2. Handle needs_ocr status
      if (result.status === 'needs_ocr') {
        await moduleDb
          .update(kbDocuments)
          .set({
            status: 'needs_ocr',
            metadata: JSON.stringify({ warning: result.warning }),
          })
          .where(eq(kbDocuments.id, documentId));
        return;
      }

      // 3. Process document (chunk + embed + store)
      const { processDocument } = await import('./lib/pipeline');
      await processDocument(moduleDb, documentId, result.text);
    } finally {
      // 4. Always clean up temp file
      try {
        unlinkSync(filePath);
      } catch {
        // File may already be deleted — ignore
      }
    }
  },
);
