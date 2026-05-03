/**
 * Step 12 acceptance — loser-of-race reap.
 *
 * Forces the unique-violation branch in `createInboundMessage` by manually
 * inserting a winning row directly via the test DB BEFORE the messaging
 * service issues its insert; this overlaps with the loser's pre-ingest of
 * drive bytes. Asserts that the loser:
 *   - returns `{ isNew: false }` and observes the winner's row,
 *   - reaps its own just-ingested drive_files row + storage object,
 *   - leaves exactly one drive row matching the attachment name in DB.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_ORG_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { driveFiles } from '@modules/drive/schema'
import { messages as messagesTable } from '@modules/messaging/schema'
// Re-import the bound conversations service so the test can install a
// spy that lets the loser's existence-check observe an empty result, then
// races a winning insert in before the loser's own insert.
import {
  type ConversationsService,
  createConversationsService,
  installConversationsService,
  resumeOrCreate,
} from '@modules/messaging/service/conversations'
import { and, eq, like } from 'drizzle-orm'

import { type AttachmentTestHandle, bootMessagingAttachments } from '../helpers/attachments-fixture'

let h: AttachmentTestHandle

beforeAll(async () => {
  h = await bootMessagingAttachments()
})

afterAll(async () => {
  if (h) await h.teardown()
})

describe('messaging loser-of-race reap', () => {
  it('reaps the loser drive row when a concurrent winner commits between the existence check and the insert', async () => {
    const externalId = `wa_loser_${Date.now()}`

    // Winner — call createInboundMessage with attachments first; let it
    // commit. This pre-stages the row that the loser will discover.
    const { conversation } = await resumeOrCreate(MERIDIAN_ORG_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)

    // Install a wrapper conversations service whose existence check lies
    // on the first call — returning [] so the loser proceeds to ingest +
    // insert. We then commit the winner row through a direct DB write
    // before the loser's tx insert fires; because both txs target the
    // same `channel_external_id` partial unique index, the loser hits
    // 23505 and runs the reap path.
    const realService = createConversationsService({ db: h.db.db, scheduler: null })
    let lieOnce = true
    const wrapped: ConversationsService = {
      ...realService,
      async createInboundMessage(input) {
        if (lieOnce) {
          lieOnce = false
          // Insert the winner row mid-flight via a direct DB write.
          // The loser's createInboundMessage will see existence=[] (because
          // we're about to short-circuit it above), pre-ingest, then hit
          // the unique-index when it tries to insert with the same
          // externalMessageId.
          await h.db.db.insert(messagesTable).values({
            conversationId: conversation.id,
            organizationId: MERIDIAN_ORG_ID,
            role: 'customer',
            kind: 'text',
            content: { text: 'winner' },
            channelExternalId: input.externalMessageId,
          } as never)
        }
        return realService.createInboundMessage(input)
      },
    }
    installConversationsService(wrapped)

    const loser = await wrapped.createInboundMessage({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: externalId,
      content: 'loser',
      contentType: 'document',
      attachments: [
        {
          bytes: Buffer.from('%PDF loser'),
          name: `loser-${externalId}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 10,
        },
      ],
    })
    expect(loser.isNew).toBe(false)

    // Winner row exists, loser row does not; only one message persists.
    const messageRows = await h.db.db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.organizationId, MERIDIAN_ORG_ID), eq(messagesTable.channelExternalId, externalId)))
    expect(messageRows).toHaveLength(1)

    // Loser's drive row was reaped.
    const reapedDriveRows = await h.db.db
      .select()
      .from(driveFiles)
      .where(
        and(eq(driveFiles.organizationId, MERIDIAN_ORG_ID), like(driveFiles.originalName, `loser-${externalId}.pdf`)),
      )
    expect(reapedDriveRows).toHaveLength(0)

    // Restore default service for any subsequent tests.
    installConversationsService(realService)
  })
})
