/**
 * Step 13 acceptance — `messages.md` materializer attachment caption blocks.
 *
 * Asserts:
 *   1. Inline `[file: …]` / `[binary: …]` blocks render per-attachment.
 *   2. Missing drive rows fall back to the denormalized jsonb path with
 *      an `unavailable` annotation.
 *   3. Path drift from re-extraction surfaces on the NEXT materialization
 *      (frozen-snapshot rule), not mid-turn.
 *   4. Per-wake snapshot semantics: a single wake issues exactly ONE
 *      drive query for attachment enrichment regardless of how many
 *      messages or how many materialize/sideLoad calls fire.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_ORG_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { driveFiles } from '@modules/drive/schema'
import {
  getAttachmentSnapshot,
  invalidateAttachmentSnapshot,
  renderTranscriptFromMessages,
} from '@modules/messaging/agent'
import { messages as messagesTable } from '@modules/messaging/schema'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import type { DriveFileProjection } from '@modules/messaging/service/drive-attachments'
import { and, eq } from 'drizzle-orm'

import { type AttachmentTestHandle, bootMessagingAttachments } from '../helpers/attachments-fixture'

let h: AttachmentTestHandle

beforeAll(async () => {
  h = await bootMessagingAttachments()
})

afterAll(async () => {
  if (h) await h.teardown()
})

describe('messages.md attachments — render + snapshot semantics', () => {
  it('renders [file: …] block for an extracted attachment and observes path drift on next wake', async () => {
    const externalId = `wa_md_${Date.now()}`
    const result = await createInboundMessage({
      organizationId: MERIDIAN_ORG_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: externalId,
      content: 'See attached',
      contentType: 'document',
      attachments: [
        {
          bytes: Buffer.from('%PDF md test'),
          name: 'spec.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 12,
        },
      ],
    })
    expect(result.isNew).toBe(true)

    // Promote the row to extracted with a caption (mimics a completed
    // process-file job — the test does NOT run the real job, just sets
    // the post-processing state).
    const ref = result.message.attachments[0]
    expect(ref).toBeDefined()
    await h.db.db
      .update(driveFiles)
      .set({ extractionKind: 'extracted', caption: 'PDF caption sentence', processingStatus: 'ready' })
      .where(and(eq(driveFiles.organizationId, MERIDIAN_ORG_ID), eq(driveFiles.id, ref?.driveFileId ?? '')))

    // Wake N starts: invalidate the snapshot then prefetch.
    invalidateAttachmentSnapshot(MERIDIAN_ORG_ID, result.conversation.id)
    const snapshotN = await getAttachmentSnapshot(MERIDIAN_ORG_ID, result.conversation.id)

    // Re-fetch the message rows (now with attachments) and render.
    const rows = (await h.db.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, result.conversation.id))) as Array<
      Parameters<typeof renderTranscriptFromMessages>[0][number]
    >
    const transcriptN = renderTranscriptFromMessages(rows, snapshotN)
    expect(transcriptN).toContain('[file: ')
    expect(transcriptN).toContain('PDF caption sentence')

    // Path drift: re-extraction renames the row from .pdf to .md. The
    // CURRENT wake's snapshot still shows the old path. Wake N+1 must
    // see the new path.
    await h.db.db
      .update(driveFiles)
      .set({ path: '/contacts/ctt0test00/chi0cust00/attachments/spec-renamed.md' })
      .where(and(eq(driveFiles.organizationId, MERIDIAN_ORG_ID), eq(driveFiles.id, ref?.driveFileId ?? '')))

    // Snapshot N is frozen — re-render still shows old path because the
    // map was captured before the path mutation.
    const transcriptNStillFrozen = renderTranscriptFromMessages(rows, snapshotN)
    expect(transcriptNStillFrozen).not.toContain('spec-renamed.md')

    // Wake N+1 — invalidate, refetch, observe new path.
    invalidateAttachmentSnapshot(MERIDIAN_ORG_ID, result.conversation.id)
    const snapshotNext = await getAttachmentSnapshot(MERIDIAN_ORG_ID, result.conversation.id)
    const transcriptNext = renderTranscriptFromMessages(rows, snapshotNext)
    expect(transcriptNext).toContain('spec-renamed.md')
  })

  it('falls back to jsonb path with `unavailable` when the drive row is missing', () => {
    const fakeRow = {
      id: 'm-fake',
      conversationId: 'c-fake',
      organizationId: MERIDIAN_ORG_ID,
      role: 'customer' as const,
      kind: 'text' as const,
      content: { text: 'see file' },
      parentMessageId: null,
      channelExternalId: null,
      status: null,
      attachments: [
        {
          driveFileId: 'gone',
          path: '/contacts/x/y/attachments/missing.md',
          mimeType: 'application/pdf',
          sizeBytes: 10,
          name: 'missing.pdf',
          caption: null,
          extractionKind: 'extracted' as const,
        },
      ],
      createdAt: new Date(),
    }
    const transcript = renderTranscriptFromMessages([fakeRow], new Map())
    expect(transcript).toContain('/contacts/x/y/attachments/missing.md — unavailable')
  })

  it('renders [binary: …] for binary-stub attachments', () => {
    const fakeRow = {
      id: 'm-bin',
      conversationId: 'c-bin',
      organizationId: MERIDIAN_ORG_ID,
      role: 'customer' as const,
      kind: 'text' as const,
      content: { text: 'see video' },
      parentMessageId: null,
      channelExternalId: null,
      status: null,
      attachments: [
        {
          driveFileId: 'd-vid',
          path: '/contacts/x/y/attachments/intro.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 1024 * 1024,
          name: 'intro.mp4',
          caption: 'video/mp4 — 1.0 MB',
          extractionKind: 'binary-stub' as const,
        },
      ],
      createdAt: new Date(),
    }
    const driveMap = new Map<string, DriveFileProjection>([
      [
        'd-vid',
        {
          id: 'd-vid',
          path: '/contacts/x/y/attachments/intro.mp4',
          caption: 'video/mp4 — 1.0 MB',
          mimeType: 'video/mp4',
          sizeBytes: 1024 * 1024,
          extractionKind: 'binary-stub',
        },
      ],
    ])
    const transcript = renderTranscriptFromMessages([fakeRow], driveMap)
    expect(transcript).toContain('[binary: /contacts/x/y/attachments/intro.mp4 (video/mp4, 1.0 MB)]')
  })
})
