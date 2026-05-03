import { describe, expect, test } from 'bun:test'

import { deriveDriveName } from './drive-name'

describe('deriveDriveName', () => {
  test('rewrites extractable mime to .md', () => {
    expect(deriveDriveName({ originalName: 'quote.pdf', mimeType: 'application/pdf' })).toEqual({
      nameStem: 'quote',
      displayName: 'quote.md',
    })
  })

  test('preserves original ext for binary mime', () => {
    expect(deriveDriveName({ originalName: 'intro.mp4', mimeType: 'video/mp4' })).toEqual({
      nameStem: 'intro',
      displayName: 'intro.mp4',
    })
  })

  test('handles dotless filenames on binary', () => {
    expect(deriveDriveName({ originalName: 'README', mimeType: 'application/octet-stream' })).toEqual({
      nameStem: 'README',
      displayName: 'README',
    })
  })

  test('handles dotless filenames on extractable mime', () => {
    expect(deriveDriveName({ originalName: 'notes', mimeType: 'text/plain' })).toEqual({
      nameStem: 'notes',
      displayName: 'notes.md',
    })
  })

  test('strips path segments', () => {
    expect(deriveDriveName({ originalName: 'folder/sub/quote.pdf', mimeType: 'application/pdf' })).toEqual({
      nameStem: 'quote',
      displayName: 'quote.md',
    })
  })

  test('docx and xlsx route to .md', () => {
    expect(
      deriveDriveName({
        originalName: 'spec.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }).displayName,
    ).toBe('spec.md')
    expect(
      deriveDriveName({
        originalName: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }).displayName,
    ).toBe('sheet.md')
  })

  test('zip stays as .zip (not extractable)', () => {
    expect(deriveDriveName({ originalName: 'archive.zip', mimeType: 'application/zip' })).toEqual({
      nameStem: 'archive',
      displayName: 'archive.zip',
    })
  })

  test('treats leading-dot files as having no extension', () => {
    expect(deriveDriveName({ originalName: '.gitignore', mimeType: 'application/octet-stream' })).toEqual({
      nameStem: '.gitignore',
      displayName: '.gitignore',
    })
  })
})
