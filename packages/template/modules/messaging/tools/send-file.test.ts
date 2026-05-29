import { beforeEach, describe, expect, it } from 'bun:test'
import { installOutboundService, type SendOutboundInput } from '@modules/channels/service/outbound'
import { setFilesRuntime } from '@modules/drive/service/files'
import {
  __resetConversationsServiceForTests,
  type ConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import type { ToolContext } from '@vobase/core'
import { setJournalDb } from '@vobase/core'

import type { AppStorage, BucketHandle } from '~/runtime/storage'
import type { Conversation } from '../schema'
import { sendFileTool } from './send-file'

type Row = Record<string, unknown>

let messageStore: Row[] = []
let eventStore: Row[] = []

function makeDb() {
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      let insertIdx = 0
      const tx = {
        insert: (_table: unknown) => {
          const idx = ++insertIdx
          return {
            values: (v: unknown) => {
              if (idx === 1) {
                const row = { id: 'msg-file-1', ...(v as Row) }
                messageStore.push(row)
                return { returning: async () => [row] }
              }
              eventStore.push(v as Row)
              return Promise.resolve()
            },
          }
        },
      }
      return fn(tx)
    },
  }
}

const noopJournalDb = { insert: (_: unknown) => ({ values: (_v: unknown) => Promise.resolve() }) }

/**
 * Drive db stub: `filesServiceFor(orgId).get(id)` issues a select-from-where
 * over `drive_files`; we intercept and return a single fake `DriveFile` row.
 */
function makeDriveDb() {
  const fakeFile = {
    id: 'file-abc',
    organizationId: 'org-1',
    name: 'x.png',
    originalName: 'x.png',
    mimeType: 'image/png',
    storageKey: 'k1',
    scope: 'organization' as const,
    scopeId: 'org-1',
  }
  const rows = [fakeFile]
  return {
    select: (_cols?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_c: unknown) => ({
          limit: async (_n: number) => rows,
        }),
      }),
    }),
  }
}

function makeStorage(): AppStorage {
  const bucket: BucketHandle = {
    upload: async () => undefined,
    download: async (_key: string) => new Uint8Array([0x66, 0x61, 0x6b, 0x65]), // "fake"
    delete: async () => undefined,
    exists: async () => true,
  }
  return {
    raw: {} as AppStorage['raw'],
    bucket: () => bucket,
  }
}

let outboundCalls: SendOutboundInput[] = []

const fakeConv: Conversation = {
  id: 'conv-1',
  organizationId: 'org-1',
  contactId: 'ctc-1',
  channelInstanceId: 'ci-1',
  status: 'active',
  assignee: 'agt-1',
  ownerUserId: null,
  ownerAssignedAt: null,
  threadKey: 'default',
  emailSubject: null,
  snoozedUntil: null,
  snoozedReason: null,
  snoozedBy: null,
  snoozedAt: null,
  snoozedJobId: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeConversationsServiceStub(): ConversationsService {
  // biome-ignore lint/suspicious/useAwait: trivial async stub
  const notImplemented = async () => {
    throw new Error('not implemented in stub')
  }
  return {
    create: notImplemented as ConversationsService['create'],
    resumeOrCreate: notImplemented as ConversationsService['resumeOrCreate'],
    get: (async () => fakeConv) as ConversationsService['get'],
    listActivity: notImplemented as ConversationsService['listActivity'],
    createInboundMessage: notImplemented as ConversationsService['createInboundMessage'],
    snooze: notImplemented as ConversationsService['snooze'],
    unsnooze: notImplemented as ConversationsService['unsnooze'],
    wakeSnoozed: notImplemented as ConversationsService['wakeSnoozed'],
    resolve: notImplemented as ConversationsService['resolve'],
    reopen: notImplemented as ConversationsService['reopen'],
    reset: notImplemented as ConversationsService['reset'],
    reassign: notImplemented as ConversationsService['reassign'],
    setOwner: notImplemented as ConversationsService['setOwner'],
    lastOwnerAssignedAt: notImplemented as ConversationsService['lastOwnerAssignedAt'],
    list: notImplemented as ConversationsService['list'],
    listMessagingByContact: notImplemented as ConversationsService['listMessagingByContact'],
    sendText: notImplemented as ConversationsService['sendText'],
    sendCard: notImplemented as ConversationsService['sendCard'],
    sendImage: notImplemented as ConversationsService['sendImage'],
  }
}

beforeEach(() => {
  messageStore = []
  eventStore = []
  outboundCalls = []
  installMessagesService(createMessagesService({ db: makeDb() }))
  setJournalDb(noopJournalDb)
  setFilesRuntime(makeDriveDb(), null, makeStorage(), null, null)
  __resetConversationsServiceForTests()
  installConversationsService(makeConversationsServiceStub())
  installOutboundService({
    sendOutbound: (input) => {
      outboundCalls.push(input)
      return Promise.resolve({ success: true })
    },
  })
})

function makeCtx(): ToolContext {
  return {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    wakeId: 'wake-1',
    agentId: 'agt-1',
    turnIndex: 0,
    toolCallId: 'tc-1',
  }
}

describe('sendFileTool', () => {
  it('has stable name and requiresApproval=true', () => {
    expect(sendFileTool.name).toBe('send_file')
    expect(sendFileTool.requiresApproval).toBe(true)
  })

  it('rejects empty driveFileId', async () => {
    const result = await sendFileTool.execute({ driveFileId: '' }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('rejects empty input (neither driveFileId nor url)', async () => {
    const result = await sendFileTool.execute({}, makeCtx())
    expect(result.ok).toBe(false)
  })

  it('rejects both driveFileId and url set', async () => {
    const result = await sendFileTool.execute({ driveFileId: 'file-abc', url: 'https://example.com/x.png' }, makeCtx())
    expect(result.ok).toBe(false)
  })

  it('rejects non-http url', async () => {
    const result = await sendFileTool.execute({ url: 'file:///etc/passwd' }, makeCtx())
    expect(result.ok).toBe(false)
  })

  it('happy path returns messageId and writes media message + event in one tx', async () => {
    const result = await sendFileTool.execute({ driveFileId: 'file-abc' }, makeCtx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.messageId).toBe('msg-file-1')
    expect(messageStore).toHaveLength(1)
    expect(eventStore).toHaveLength(1)
    expect(outboundCalls).toHaveLength(1)
    expect(outboundCalls[0]?.toolName).toBe('send_file')
    expect(outboundCalls[0]?.organizationId).toBe('org-1')
    expect(outboundCalls[0]?.conversationId).toBe('conv-1')
  })

  it('accepts optional caption', async () => {
    const result = await sendFileTool.execute({ driveFileId: 'file-abc', caption: 'See attached' }, makeCtx())
    expect(result.ok).toBe(true)
  })

  it('threat-scan stub always passes (Phase 2)', async () => {
    const result = await sendFileTool.execute({ driveFileId: 'any-file' }, makeCtx())
    expect(result.ok).toBe(true)
  })

  it('accepts a bash-view drive path as driveFileId (no fabricated id needed)', async () => {
    const result = await sendFileTool.execute({ driveFileId: '/drive/x.png' }, makeCtx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.messageId).toBe('msg-file-1')
    expect(messageStore).toHaveLength(1)
    expect(outboundCalls).toHaveLength(1)
  })

  it('does NOT create a message row when the drive file cannot be resolved', async () => {
    // Stub drive db to return zero rows — simulates wrong id / wrong path.
    setFilesRuntime(
      {
        select: () => ({
          from: () => ({ where: () => ({ limit: async () => [] }) }),
        }),
      },
      null,
      makeStorage(),
      null,
      null,
    )
    const result = await sendFileTool.execute({ driveFileId: 'bogus' }, makeCtx())
    expect(result.ok).toBe(false)
    expect(messageStore).toHaveLength(0)
    expect(outboundCalls).toHaveLength(0)
  })

  it('url path: fetches bytes server-side and ships them as multipart data', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
      // Sanity: Accept header excludes webp so CDNs serve jpeg/png.
      expect(init?.headers?.Accept).toContain('image/jpeg')
      expect(init?.headers?.Accept).not.toContain('webp')
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    }) as typeof fetch
    try {
      const result = await sendFileTool.execute(
        { url: 'https://example.com/menu.jpg', caption: 'Seminar package' },
        makeCtx(),
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.content.messageId).toBe('msg-file-1')
      expect(messageStore).toHaveLength(1)
      expect(outboundCalls).toHaveLength(1)
      const payload = outboundCalls[0]?.payload as {
        media: { url?: string; type?: string; caption?: string; data?: unknown; mimeType?: string }
      }
      expect(payload.media.type).toBe('image')
      expect(payload.media.caption).toBe('Seminar package')
      // Multipart, NOT link — Meta gets our bytes so CDN content-negotiation
      // can't downgrade the mime out from under us.
      expect(payload.media.url).toBeUndefined()
      expect(payload.media.data).toBeTruthy()
      expect(payload.media.mimeType).toBe('image/jpeg')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('url path: transcodes webp to jpeg when CDN ignores Accept (Cloudflare Polish bypass)', async () => {
    // Encode a real 1×1 webp so Bun.Image can decode it; round-trip through
    // jpeg() to confirm the seam reaches Meta as image/jpeg.
    const webpBytes = await new Bun.Image(
      Buffer.from(
        // 1×1 red PNG — Bun.Image auto-detects format, then we re-encode as webp.
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
        'base64',
      ),
    )
      .webp()
      .bytes()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(webpBytes), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      })) as unknown as typeof fetch
    try {
      const result = await sendFileTool.execute({ url: 'https://example.com/menu.jpg' }, makeCtx())
      expect(result.ok).toBe(true)
      expect(messageStore).toHaveLength(1)
      expect(outboundCalls).toHaveLength(1)
      const payload = outboundCalls[0]?.payload as { media: { mimeType?: string; data?: unknown } }
      expect(payload.media.mimeType).toBe('image/jpeg')
      expect(payload.media.data).toBeTruthy()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('url path: explicit type overrides inferred', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })) as unknown as typeof fetch
    try {
      const result = await sendFileTool.execute({ url: 'https://example.com/file', type: 'document' }, makeCtx())
      expect(result.ok).toBe(true)
      const payload = outboundCalls[0]?.payload as { media: { type?: string } }
      expect(payload.media.type).toBe('document')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
