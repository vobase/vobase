import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { DriveFile } from '../schema'
import { DriveBrowser } from './drive-browser'
import { DriveProvider } from './drive-provider'

const rows: DriveFile[] = [
  {
    id: 'f-1',
    organizationId: 't1',
    scope: 'organization',
    scopeId: 't1',
    parentFolderId: null,
    kind: 'folder',
    name: 'policies',
    path: '/policies',
    mimeType: null,
    sizeBytes: null,
    storageKey: null,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: null,
    source: null,
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'ready',
    processingError: null,
    threatScanReport: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  {
    id: 'f-2',
    organizationId: 't1',
    scope: 'organization',
    scopeId: 't1',
    parentFolderId: null,
    kind: 'file',
    name: 'BUSINESS.md',
    path: '/BUSINESS.md',
    mimeType: 'text/markdown',
    sizeBytes: null,
    storageKey: null,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: 'hello',
    source: null,
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'ready',
    processingError: null,
    threatScanReport: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
]

mock.module('../../api/use-drive', () => ({
  useDriveList: () => ({ data: rows, isLoading: false, error: null }),
  useDriveFile: () => ({ data: null, isLoading: false, error: null }),
  useWriteFile: () => ({ mutateAsync: async () => undefined }),
  useMkdir: () => ({ mutateAsync: async () => undefined }),
  useRemoveFile: () => ({ mutateAsync: async () => undefined }),
  useMoveFile: () => ({ mutateAsync: async () => undefined }),
}))

describe('DriveBrowser', () => {
  // biome-ignore lint/suspicious/useAwait: test setup may invoke async helpers
  it('renders Drive-style file list with breadcrumbs', async () => {
    const html = renderToStaticMarkup(
      <DriveProvider scope={{ scope: 'organization' }} rootLabel="Test root">
        <DriveBrowser />
      </DriveProvider>,
    )
    expect(html).toContain('policies')
    expect(html).toContain('BUSINESS.md')
    expect(html).toContain('Test root')
    expect(html).toContain('Last modified')
  })
})
