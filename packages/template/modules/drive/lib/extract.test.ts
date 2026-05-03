import { describe, expect, test } from 'bun:test'

import { EXTRACTABLE_MAX_BYTES } from '../constants'
import { extract, resolveEffectiveMime, sniffMagicBytes } from './extract'

describe('sniffMagicBytes', () => {
  test('detects PDF', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(sniffMagicBytes(buf)).toBe('application/pdf')
  })
  test('detects JPEG', () => {
    expect(sniffMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
  })
  test('detects PNG', () => {
    expect(sniffMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
  })
  test('detects WebP only with WEBP at offset 8', () => {
    const ok = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0x57, 0x45, 0x42, 0x50]),
    ])
    expect(sniffMagicBytes(ok)).toBe('image/webp')
    const noWebp = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0, 0, 0, 0]),
    ])
    expect(sniffMagicBytes(noWebp)).toBeNull()
  })
  test('detects zip family magic', () => {
    expect(sniffMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('application/zip')
  })
})

describe('resolveEffectiveMime', () => {
  const stub = {
    mimeType: 'application/zip',
    sizeBytes: 100,
    name: 'a.zip',
    path: '/a.zip',
    storageKey: 'k',
  }
  test('docx zip-magic resolves via ext', () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    expect(
      resolveEffectiveMime({
        bytes,
        mimeType: 'application/octet-stream',
        originalName: 'plan.docx',
        stub,
      }),
    ).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })
  test('raw .zip stays application/zip', () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    expect(resolveEffectiveMime({ bytes, mimeType: 'application/zip', originalName: 'archive.zip', stub })).toBe(
      'application/zip',
    )
  })
  test('lying mime is overridden by magic', () => {
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(resolveEffectiveMime({ bytes: pdfBytes, mimeType: 'image/jpeg', originalName: 'lol.jpg', stub })).toBe(
      'application/pdf',
    )
  })
})

describe('extract', () => {
  const baseStub = {
    mimeType: 'video/mp4',
    sizeBytes: 1000,
    name: 'intro.mp4',
    path: '/intro.mp4',
    storageKey: 'k',
  }

  test('oversized files route to binary-stub', async () => {
    const huge = Buffer.alloc(EXTRACTABLE_MAX_BYTES + 10, 0xff)
    const result = await extract({
      bytes: huge,
      mimeType: 'application/pdf',
      originalName: 'big.pdf',
      stub: baseStub,
    })
    expect(result.kind).toBe('binary-stub')
    if (result.kind === 'binary-stub') {
      expect(result.markdown).toContain('binary-file')
    }
  })

  test('plain text passes through verbatim', async () => {
    const result = await extract({
      bytes: Buffer.from('Hello world'),
      mimeType: 'text/plain',
      originalName: 'note.txt',
      stub: baseStub,
    })
    expect(result.kind).toBe('extracted')
    if (result.kind === 'extracted') expect(result.markdown).toBe('Hello world')
  })

  test('binary mp4 routes to binary-stub', async () => {
    const result = await extract({
      bytes: Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
      mimeType: 'video/mp4',
      originalName: 'intro.mp4',
      stub: baseStub,
    })
    expect(result.kind).toBe('binary-stub')
    if (result.kind === 'binary-stub') expect(result.markdown).toContain('MP4 video')
  })

  test('zip extension that is actually plain bytes — falls through to stub', async () => {
    // Bytes do NOT start with PK; mime says zip; ext says zip — no extract path.
    const result = await extract({
      bytes: Buffer.from('not really a zip'),
      mimeType: 'application/zip',
      originalName: 'fake.zip',
      stub: { ...baseStub, mimeType: 'application/zip', name: 'fake.zip' },
    })
    expect(result.kind).toBe('binary-stub')
  })

  test('image without OCR provider returns extracted with placeholder', async () => {
    // 1x1 PNG
    const png = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // signature
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52, // IHDR
    ])
    const result = await extract({
      bytes: png,
      mimeType: 'image/png',
      originalName: 'tiny.png',
      stub: baseStub,
    })
    expect(result.kind).toBe('extracted')
  })

  test('image with stubbed OCR returns the OCR text + ocrSummary', async () => {
    const ocr = async () => ({ summary: 'A blue square.', text: 'BLUE' })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const result = await extract({
      bytes: png,
      mimeType: 'image/png',
      originalName: 'tiny.png',
      stub: baseStub,
      ocr,
    })
    expect(result.kind).toBe('extracted')
    if (result.kind === 'extracted') {
      expect(result.markdown).toContain('BLUE')
      expect(result.ocrSummary).toBe('A blue square.')
    }
  })
})
