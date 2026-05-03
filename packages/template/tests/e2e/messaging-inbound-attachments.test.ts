/**
 * Step 12 acceptance — basic inbound-attachment ingest.
 *
 * Calls `createInboundMessage` with a buffered PDF attachment and asserts
 * the message row carries an `attachments[]` ref pointing at a drive file
 * that lives at `/contacts/<id>/<channelInstanceId>/attachments/{stem}.md`.
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

describe('messaging inbound attachments — happy path', () => {
  it('creates a drive row and persists attachments[] on the message', async () => {
    const externalId = `wa_${Date.now()}_attach`
    const result = await createInboundMessage({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: externalId,
      content: 'See attached',
      contentType: 'document',
      attachments: [
        {
          bytes: Buffer.from('%PDF-1.4 fake pdf bytes'),
          name: 'quote.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 23,
        },
      ],
    })
    expect(result.isNew).toBe(true)
    const persisted = (await h.db.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, result.message.id))
      .limit(1)) as Array<{ attachments: Array<{ driveFileId: string; path: string; name: string }> }>
    expect(persisted[0]?.attachments).toBeArray()
    expect(persisted[0]?.attachments).toHaveLength(1)
    const ref = persisted[0]?.attachments[0]
    expect(ref?.name).toBe('quote.pdf')
    expect(ref?.path).toBe(`/contacts/${SEEDED_CONTACT_ID}/${CUSTOMER_CHANNEL_INSTANCE_ID}/attachments/quote.md`)

    // Drive row matches.
    const driveRows = (
      await h.db.db
        .select()
        .from(driveFiles)
        .where(and(eq(driveFiles.organizationId, MERIDIAN_ORG_ID), eq(driveFiles.id, ref?.driveFileId ?? '')))
    )
      // biome-ignore lint/suspicious/noExplicitAny: drizzle row shape narrowed by the WHERE
      .map((r: any) => ({ path: r.path, source: r.source, extractionKind: r.extractionKind, scope: r.scope }))
    expect(driveRows).toHaveLength(1)
    expect(driveRows[0]?.scope).toBe('contact')
    expect(driveRows[0]?.source).toBe('customer_inbound')

    // One process-file job enqueued for the attachment.
    const driveJobs = h.jobs.sent.filter((j) => j.name === 'drive:process-file')
    expect(driveJobs.length).toBeGreaterThanOrEqual(1)
  })
})
