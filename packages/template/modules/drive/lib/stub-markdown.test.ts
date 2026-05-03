import { describe, expect, test } from 'bun:test'

import { humanBytes, humanMime, renderStub } from './stub-markdown'

describe('humanBytes', () => {
  test('formats sizes', () => {
    expect(humanBytes(900)).toBe('900 B')
    expect(humanBytes(2 * 1024)).toBe('2.0 KB')
    expect(humanBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(humanBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })
})

describe('humanMime', () => {
  test('produces readable labels', () => {
    expect(humanMime('application/pdf')).toBe('PDF document')
    expect(humanMime('image/jpeg')).toBe('JPEG image')
    expect(humanMime('video/mp4')).toBe('MP4 video')
    expect(humanMime('application/zip')).toBe('ZIP archive')
  })
})

describe('renderStub', () => {
  test('emits frontmatter + action affordances', () => {
    const md = renderStub({
      mimeType: 'video/mp4',
      sizeBytes: 5 * 1024 * 1024,
      name: 'intro.mp4',
      path: '/contacts/c1/wa-1/attachments/intro.mp4',
      storageKey: 'drive/contact/c1/abc/intro.mp4',
    })
    expect(md).toContain('type: binary-file')
    expect(md).toContain('mime: video/mp4')
    expect(md).toContain('size: 5.0 MB')
    expect(md).toContain('send_file /contacts/c1/wa-1/attachments/intro.mp4')
    expect(md).toContain('request_caption /contacts/c1/wa-1/attachments/intro.mp4')
  })
})
