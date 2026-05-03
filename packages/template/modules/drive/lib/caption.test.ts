import { describe, expect, test } from 'bun:test'

import { deriveCaption } from './caption'

describe('deriveCaption', () => {
  test('binary-stub uses humanMime + humanBytes', () => {
    expect(deriveCaption({ kind: 'binary-stub', mimeType: 'video/mp4', sizeBytes: 5 * 1024 * 1024 })).toBe(
      'MP4 video — 5.0 MB',
    )
  })

  test('extracted PDF takes first 120 chars sentence-trimmed', () => {
    const text = `Quote for project Atlas. The total is $4500. Due in 30 days. ${'x'.repeat(200)}`
    const caption = deriveCaption({
      kind: 'extracted',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      extractedText: text,
    })
    expect(caption.length).toBeLessThanOrEqual(120)
    expect(caption).toContain('Quote for project Atlas')
  })

  test('extracted image prefers ocrSummary', () => {
    const caption = deriveCaption({
      kind: 'extracted',
      mimeType: 'image/jpeg',
      sizeBytes: 100_000,
      extractedText: 'Page 1 of 2  Company X 2025...',
      ocrSummary: 'A receipt for groceries totalling $12.',
    })
    expect(caption).toBe('A receipt for groceries totalling $12.')
  })

  test('extracted image falls back to text when no ocrSummary', () => {
    const caption = deriveCaption({
      kind: 'extracted',
      mimeType: 'image/jpeg',
      sizeBytes: 100_000,
      extractedText: 'Hello from the image text.',
    })
    expect(caption).toBe('Hello from the image text.')
  })

  test('empty extracted text falls back to mime+size', () => {
    expect(deriveCaption({ kind: 'extracted', mimeType: 'application/pdf', sizeBytes: 1024, extractedText: '' })).toBe(
      'PDF document — 1.0 KB',
    )
  })
})
