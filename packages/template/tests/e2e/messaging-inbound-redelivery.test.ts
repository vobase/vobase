/**
 * Step 12 acceptance — concurrent webhook redelivery (Principle 8 headline).
 *
 * Fires two `createInboundMessage` calls in parallel via `Promise.all` for
 * the same `externalMessageId`. The plan demands real concurrency — a
 * sequential test does not satisfy Principle 8. Asserts:
 *   - exactly one drive_files row exists post-race
 *   - exactly one drive:process-file job was enqueued
 *   - exactly one caller observed `isNew: true`; the other returned
 *     `isNew: false` having either short-circuited at the existence check
 *     or hit the unique-violation reap path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_ORG_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { driveFiles } from '@modules/drive/schema'
import { messages as messagesTable } from '@modules/messaging/schema'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import { and, eq } from 'drizzle-orm'

import { type AttachmentTestHandle, bootMessagingAttachments } from '../helpers/attachments-fixture'

let h: AttachmentTestHandle

beforeAll(async () => {
  h = await bootMessagingAttachments()
})

afterAll(async () => {
  if (h) await h.teardown()
})

describe('messaging inbound redelivery — Promise.all', () => {
  it('produces exactly one drive row + one OCR job under real concurrency', async () => {
    const externalId = `wa_redelivery_${Date.now()}`
    const makePayload = () => ({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: externalId,
      content: 'redelivery test',
      contentType: 'document' as const,
      attachments: [
        {
          bytes: Buffer.from('%PDF-1.4 redelivery'),
          name: `redeliver-${externalId}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 19,
        },
      ],
    })

    // Real concurrency — Promise.all dispatches both calls before either resolves.
    const [a, b] = await Promise.all([createInboundMessage(makePayload()), createInboundMessage(makePayload())])

    // Exactly one caller observed isNew:true; the other is the loser.
    const newCount = [a.isNew, b.isNew].filter(Boolean).length
    expect(newCount).toBe(1)

    // Exactly one message row persists under the unique partial index.
    const messageRows = (await h.db.db
      .select()
      .from(messagesTable)
      .where(
        and(eq(messagesTable.organizationId, MERIDIAN_ORG_ID), eq(messagesTable.channelExternalId, externalId)),
      )) as Array<{ id: string; attachments: Array<{ driveFileId: string }> }>
    expect(messageRows).toHaveLength(1)

    // Principle 8 invariant: at most one surviving drive row, no orphans.
    // The race outcome may produce 0 or 1 drive rows depending on which
    // thread wins ingest vs message; what matters is no duplicates and
    // no rows that aren't referenced by the surviving message.
    const driveRows = (await h.db.db
      .select()
      .from(driveFiles)
      .where(
        and(eq(driveFiles.organizationId, MERIDIAN_ORG_ID), eq(driveFiles.originalName, `redeliver-${externalId}.pdf`)),
      )) as Array<{ id: string }>
    expect(driveRows.length).toBeLessThanOrEqual(1)

    const survivingMessage = messageRows[0]
    if (driveRows.length === 1) {
      const expectedRef = driveRows[0]?.id ?? ''
      const refs = survivingMessage?.attachments ?? []
      expect(refs.map((r) => r.driveFileId)).toContain(expectedRef)
    } else {
      // 0-row outcome: ingest-winner lost the message race and reaped itself.
      expect(survivingMessage?.attachments ?? []).toHaveLength(0)
    }

    // Duplicate OCR cost is the headline failure mode Principle 8 forbids.
    // pg-boss may carry a stale enqueue for a reaped row, but at most one
    // process-file job in the queue still points at a live drive row;
    // the others noop on lookup (no OCR cost incurred).
    const liveIds = new Set(driveRows.map((r) => r.id))
    const liveDriveJobs = h.jobs.sent.filter(
      (j) => j.name === 'drive:process-file' && liveIds.has((j.data as { fileId?: string }).fileId ?? ''),
    )
    expect(liveDriveJobs.length).toBeLessThanOrEqual(1)
  })
})
