/**
 * Inbound-image vision — end-to-end against real Postgres + local-fs storage.
 *
 * Proves the project-side chain the conversation wake wires together:
 * an inbound image is ingested through the real `createInboundMessage`
 * path, then `resolveTriggerImages` (via `getAttachmentsByMessageIds` →
 * `drive.get` → `storage.download` → base64) turns it into a pi-ai
 * `ImageContent` block for the first user turn. A text-only message resolves to
 * nothing. Separately, persisted history strips the image bytes to a marker so
 * they are never replayed on subsequent wakes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import { CUSTOMER_CHANNEL_INSTANCE_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { filesServiceFor } from '@modules/drive/service/files'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import { getAttachmentsByMessageIds } from '@modules/messaging/service/messages'

import type { WakeTrigger } from '~/wake/events'
import { setupMessageHistory } from '~/wake/message-history'
import { resolveTriggerImages } from '~/wake/trigger-images'
import { type AttachmentTestHandle, bootMessagingAttachments } from '../helpers/attachments-fixture'
import { getSeededOrgId } from '../helpers/seeded-org'

let h: AttachmentTestHandle
let organizationId: string

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6])

beforeAll(async () => {
  h = await bootMessagingAttachments()
  organizationId = await getSeededOrgId(h.db.db)
})

afterAll(async () => {
  if (h) await h.teardown()
})

function inboundTrigger(conversationId: string, messageIds: string[]): WakeTrigger {
  return { trigger: 'inbound_message', conversationId, messageIds }
}

function resolverCtx() {
  return {
    loadAttachments: (ids: readonly string[]) => getAttachmentsByMessageIds(h.db.db, organizationId, ids),
    drive: filesServiceFor(organizationId),
    storage: h.storage,
  }
}

describe('inbound-image vision — resolveTriggerImages over real ingestion', () => {
  it('resolves an inbound image to a base64 ImageContent with its mimeType', async () => {
    const result = await createInboundMessage({
      organizationId,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: `wa_${Date.now()}_img`,
      content: 'here is a photo of what i mean',
      contentType: 'image',
      attachments: [{ bytes: PNG_BYTES, name: 'ref.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length }],
    })

    const images = await resolveTriggerImages(
      inboundTrigger(result.conversation.id, [result.message.id]),
      resolverCtx(),
    )

    expect(images).toHaveLength(1)
    expect(images[0].type).toBe('image')
    expect(images[0].mimeType).toBe('image/png')
    expect(images[0].data).toBe(PNG_BYTES.toString('base64'))
  })

  it('resolves an image sent as a document (keyed on image/* mimeType, not message kind)', async () => {
    const result = await createInboundMessage({
      organizationId,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: `wa_${Date.now()}_imgdoc`,
      content: 'reference',
      contentType: 'document',
      attachments: [{ bytes: PNG_BYTES, name: 'ref.jpg', mimeType: 'image/jpeg', sizeBytes: PNG_BYTES.length }],
    })

    const images = await resolveTriggerImages(
      inboundTrigger(result.conversation.id, [result.message.id]),
      resolverCtx(),
    )

    expect(images).toHaveLength(1)
    expect(images[0].mimeType).toBe('image/jpeg')
  })

  it('resolves nothing for a text-only inbound message', async () => {
    const result = await createInboundMessage({
      organizationId,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      contactId: SEEDED_CONTACT_ID,
      externalMessageId: `wa_${Date.now()}_text`,
      content: 'just text',
      contentType: 'text',
    })

    const images = await resolveTriggerImages(
      inboundTrigger(result.conversation.id, [result.message.id]),
      resolverCtx(),
    )

    expect(images).toEqual([])
  })
})

describe('inbound-image vision — persisted history carries no image bytes', () => {
  it('strips ImageContent to a marker so it is never replayed', async () => {
    const conversationId = 'cnv0imgstrip'
    const userTurn = {
      role: 'user',
      content: [
        { type: 'text', text: 'see this' },
        { type: 'image', data: PNG_BYTES.toString('base64'), mimeType: 'image/png' },
      ],
      timestamp: 0,
    } as unknown as AgentMessage

    const mh = await setupMessageHistory({ db: h.db.db, agentId: MERIGPT_AGENT_ID, conversationId })
    await mh.onTurnEndSnapshot([userTurn])

    const reloaded = await setupMessageHistory({ db: h.db.db, agentId: MERIGPT_AGENT_ID, conversationId })
    const history = (await reloaded.loadMessageHistory?.()) ?? []
    const persistedUser = history.find((m) => m.role === 'user')
    const content = persistedUser?.content as Array<{ type: string }> | undefined

    expect(Array.isArray(content)).toBe(true)
    expect(content?.some((p) => p.type === 'image')).toBe(false)
  })
})
