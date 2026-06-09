import { describe, expect, it } from 'bun:test'
import type { DriveFile } from '@modules/drive/schema'
import type { MessageAttachmentRef } from '@modules/drive/service/types'

import type { WakeTrigger } from './events'
import { type ResolveTriggerImagesCtx, resolveTriggerImages } from './trigger-images'

function imageRef(over: Partial<MessageAttachmentRef> = {}): MessageAttachmentRef {
  return {
    driveFileId: 'file1',
    path: '/contacts/c1/inbound/file1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    name: 'file1.jpg',
    caption: null,
    extractionKind: 'pending',
    ...over,
  }
}

function fakeDriveGet(rows: Record<string, Partial<DriveFile>>): ResolveTriggerImagesCtx['drive'] {
  return { get: async (id: string) => (rows[id] ?? null) as DriveFile | null }
}

function fakeStorage(files: Record<string, Uint8Array>): ResolveTriggerImagesCtx['storage'] {
  return {
    bucket: () => ({ download: async (key: string) => files[key] ?? new Uint8Array() }),
  } as unknown as ResolveTriggerImagesCtx['storage']
}

const inbound = (messageIds: string[]): WakeTrigger => ({
  trigger: 'inbound_message',
  conversationId: 'c1',
  messageIds,
})

describe('resolveTriggerImages — short circuits', () => {
  const ctx: ResolveTriggerImagesCtx = {
    loadAttachments: async () => [imageRef()],
    drive: fakeDriveGet({ file1: { storageKey: 'k1', mimeType: 'image/jpeg' } }),
    storage: fakeStorage({ k1: new Uint8Array([1, 2, 3]) }),
  }

  it('returns [] for a non-inbound trigger', async () => {
    const trigger = { trigger: 'staff_note', conversationId: 'c1', noteId: 'n1', authorUserId: 'u1' } as WakeTrigger
    expect(await resolveTriggerImages(trigger, ctx)).toEqual([])
  })

  it('returns [] for an undefined trigger', async () => {
    expect(await resolveTriggerImages(undefined, ctx)).toEqual([])
  })

  it('returns [] (no throw) when storage is unavailable', async () => {
    expect(await resolveTriggerImages(inbound(['m1']), { ...ctx, storage: null })).toEqual([])
  })

  it('returns [] when the message carries no image/* attachments', async () => {
    const pdfCtx: ResolveTriggerImagesCtx = {
      ...ctx,
      loadAttachments: async () => [imageRef({ mimeType: 'application/pdf', name: 'doc.pdf' })],
    }
    expect(await resolveTriggerImages(inbound(['m1']), pdfCtx)).toEqual([])
  })

  it('returns [] (no throw) when the attachment lookup itself rejects', async () => {
    const failCtx: ResolveTriggerImagesCtx = {
      ...ctx,
      loadAttachments: () => Promise.reject(new Error('db down')),
    }
    expect(await resolveTriggerImages(inbound(['m1']), failCtx)).toEqual([])
  })
})

describe('resolveTriggerImages — byte resolution + budget', () => {
  it('reads each image to a base64 ImageContent with its mimeType', async () => {
    const ctx: ResolveTriggerImagesCtx = {
      loadAttachments: async () => [
        imageRef({ driveFileId: 'a', mimeType: 'image/jpeg' }),
        imageRef({ driveFileId: 'b', mimeType: 'image/png' }),
      ],
      drive: fakeDriveGet({ a: { storageKey: 'ka' }, b: { storageKey: 'kb' } }),
      storage: fakeStorage({ ka: new Uint8Array([1, 2, 3]), kb: new Uint8Array([4, 5, 6]) }),
    }
    expect(await resolveTriggerImages(inbound(['m1']), ctx)).toEqual([
      { type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/jpeg' },
      { type: 'image', data: Buffer.from([4, 5, 6]).toString('base64'), mimeType: 'image/png' },
    ])
  })

  it('handles an image sent as a document (image/* mimeType, not message kind)', async () => {
    const ctx: ResolveTriggerImagesCtx = {
      loadAttachments: async () => [imageRef({ driveFileId: 'a', mimeType: 'image/webp', name: 'ref.webp' })],
      drive: fakeDriveGet({ a: { storageKey: 'ka' } }),
      storage: fakeStorage({ ka: new Uint8Array([9]) }),
    }
    const out = await resolveTriggerImages(inbound(['m1']), ctx)
    expect(out).toHaveLength(1)
    expect(out[0].mimeType).toBe('image/webp')
  })

  it('skips an attachment whose drive row has no storageKey', async () => {
    const ctx: ResolveTriggerImagesCtx = {
      loadAttachments: async () => [imageRef({ driveFileId: 'a' })],
      drive: fakeDriveGet({ a: { storageKey: null } }),
      storage: fakeStorage({}),
    }
    expect(await resolveTriggerImages(inbound(['m1']), ctx)).toEqual([])
  })

  it('skips an image whose stored object is empty (zero bytes)', async () => {
    const ctx: ResolveTriggerImagesCtx = {
      loadAttachments: async () => [imageRef({ driveFileId: 'a' })],
      drive: fakeDriveGet({ a: { storageKey: 'ka' } }),
      storage: fakeStorage({ ka: new Uint8Array([]) }),
    }
    expect(await resolveTriggerImages(inbound(['m1']), ctx)).toEqual([])
  })

  it('honours maxImages — keeps only the first within budget', async () => {
    const ctx: ResolveTriggerImagesCtx = {
      loadAttachments: async () => [imageRef({ driveFileId: 'a' }), imageRef({ driveFileId: 'b' })],
      drive: fakeDriveGet({ a: { storageKey: 'ka' }, b: { storageKey: 'kb' } }),
      storage: fakeStorage({ ka: new Uint8Array([1]), kb: new Uint8Array([2]) }),
      budget: { maxImages: 1, maxImageBytes: 5_000_000, maxTotalBytes: 15_000_000 },
    }
    const out = await resolveTriggerImages(inbound(['m1']), ctx)
    expect(out).toHaveLength(1)
    expect(out[0].data).toBe(Buffer.from([1]).toString('base64'))
  })

  it('skips an oversized image (sizeBytes over the per-image cap)', async () => {
    const ctx: ResolveTriggerImagesCtx = {
      loadAttachments: async () => [imageRef({ driveFileId: 'a', sizeBytes: 9_000_000 })],
      drive: fakeDriveGet({ a: { storageKey: 'ka' } }),
      storage: fakeStorage({ ka: new Uint8Array([1]) }),
      budget: { maxImages: 4, maxImageBytes: 5_000_000, maxTotalBytes: 15_000_000 },
    }
    expect(await resolveTriggerImages(inbound(['m1']), ctx)).toEqual([])
  })

  it('never throws — a storage download failure skips that image', async () => {
    const ctx: ResolveTriggerImagesCtx = {
      loadAttachments: async () => [imageRef({ driveFileId: 'a' }), imageRef({ driveFileId: 'b' })],
      drive: fakeDriveGet({ a: { storageKey: 'ka' }, b: { storageKey: 'kb' } }),
      storage: {
        bucket: () => ({
          download: (key: string) =>
            key === 'ka' ? Promise.reject(new Error('boom')) : Promise.resolve(new Uint8Array([7])),
        }),
      } as unknown as ResolveTriggerImagesCtx['storage'],
    }
    const out = await resolveTriggerImages(inbound(['m1']), ctx)
    expect(out).toEqual([{ type: 'image', data: Buffer.from([7]).toString('base64'), mimeType: 'image/jpeg' }])
  })
})
