import { describe, expect, test } from 'bun:test'

import { lookupMime } from './lookup-mime'

describe('lookupMime', () => {
  test('resolves common extensions', () => {
    expect(lookupMime('quote.pdf')).toBe('application/pdf')
    expect(lookupMime('image.JPG')).toBe('image/jpeg')
    expect(lookupMime('intro.mp4')).toBe('video/mp4')
    expect(lookupMime('plan.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  test('resolves bare extension', () => {
    expect(lookupMime('pdf')).toBe('application/pdf')
    expect(lookupMime('.csv')).toBe('text/csv')
  })

  test('falls back to octet-stream for unknown ext', () => {
    expect(lookupMime('weird.xyz')).toBe('application/octet-stream')
    expect(lookupMime('')).toBe('application/octet-stream')
  })

  test('handles paths with dots in segments', () => {
    expect(lookupMime('archive.tar.gz')).toBe('application/gzip')
  })
})
