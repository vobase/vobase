/**
 * Step 12 acceptance — storage-upload failure inside `ingestUpload` is
 * absorbed by the warn-log + drop-attachment seam: the customer message
 * still posts (with `attachments: []`), and the drive row is left in
 * `(failed, failed)` for audit.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_ORG_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { driveFiles } from '@modules/drive/schema'
import { setFilesRuntime } from '@modules/drive/service/files'
import { messages as messagesTable } from '@modules/messaging/schema'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import { and, eq } from 'drizzle-orm'

import type { AppStorage, BucketHandle } from '~/runtime/storage'
import { type AttachmentTestHandle, bootMessagingAttachments } from '../helpers/attachments-fixture'

let h: AttachmentTestHandle

beforeAll(async () => {
  h = await bootMessagingAttachments()
  // Swap the drive bucket's upload to throw — exercises the
  // ingestUpload "storage_upload_failed" terminal-failed branch.
  const realStorage = h.storage
  const failingStorage: AppStorage = {
    raw: realStorage.raw,
    bucket(name: string): BucketHandle {
      const inner = realStorage.bucket(name)
      if (name !== 'drive') return inner
      return {
        upload: async () => {
          throw new Error('simulated storage outage')
        },
        download: inner.download,
        delete: inner.delete,
        exists: inner.exists,
      }
    },
  }
  setFilesRuntime(h.db.db, null, failingStorage, h.jobs, null)
})

afterAll(async () => {
  if (h) await h.teardown()
})

describe('messaging attachment failure — storage upload throws', () => {
  it('warn-logs and posts the message with attachments: []; drive row goes (failed, failed)', async () => {
    const externalId = `wa_fail_${Date.now()}`
    const result = await createInboundMessage({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: externalId,
      content: 'fail test',
      contentType: 'document',
      attachments: [
        {
          bytes: Buffer.from('PDF body'),
          name: `fail-${externalId}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 8,
        },
      ],
    })
    expect(result.isNew).toBe(true)

    const persisted = (await h.db.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, result.message.id))
      .limit(1)) as Array<{ attachments: unknown[] }>
    expect(persisted[0]?.attachments).toEqual([])

    const driveRows = (await h.db.db
      .select()
      .from(driveFiles)
      .where(
        and(eq(driveFiles.organizationId, MERIDIAN_ORG_ID), eq(driveFiles.originalName, `fail-${externalId}.pdf`)),
      )) as Array<{ extractionKind: string; processingStatus: string; processingError: string | null }>
    expect(driveRows).toHaveLength(1)
    expect(driveRows[0]?.extractionKind).toBe('failed')
    expect(driveRows[0]?.processingStatus).toBe('failed')
    expect(driveRows[0]?.processingError).toContain('storage_upload_failed')
  })
})
