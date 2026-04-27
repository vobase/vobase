/**
 * Drive change materializer — upserts the targeted Drive doc by path on the
 * proposal/decide transaction handle. Auto-creates intermediate folders so
 * proposals against a deep path like '/policies/refunds.md' don't fail when
 * '/policies' doesn't exist yet. Bypasses the singleton `filesService` because
 * writes must happen on the proposal/decide tx, not the bound singleton db.
 */

import {
  assertMarkdownPatch,
  type MaterializeResult,
  type Materializer,
  type TxLike,
} from '@modules/changes/service/proposals'
import { driveFiles } from '@modules/drive/schema'
import { validation } from '@vobase/core'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export const DRIVE_DOC_RESOURCE = { module: 'drive', type: 'doc' } as const

interface DriveFileRow {
  id: string
  parentFolderId: string | null
  extractedText: string | null
  kind: 'folder' | 'file'
}

export const driveDocMaterializer: Materializer = async (proposal, tx) => {
  const path = proposal.resourceId
  if (!path?.startsWith('/')) {
    throw validation({ resourceId: proposal.resourceId }, `drive/changes: resourceId must be a scope-relative path`)
  }
  const body = assertMarkdownPatch(proposal.payload).body
  const scope = 'organization'
  const scopeId = proposal.organizationId

  const before = await getByPath(tx, proposal.organizationId, scope, scopeId, path)
  const parentFolderId = await ensureParentFolders(tx, proposal.organizationId, scope, scopeId, path)
  const after = await upsertFile(tx, {
    organizationId: proposal.organizationId,
    scope,
    scopeId,
    path,
    body,
    parentFolderId,
    existingId: before?.id,
  })

  return {
    resultId: after.id,
    before: before ? { id: before.id, path, content: before.extractedText ?? '' } : null,
    after: { id: after.id, path, content: body },
  } satisfies MaterializeResult
}

async function getByPath(
  tx: TxLike,
  organizationId: string,
  scope: 'organization',
  scopeId: string,
  path: string,
): Promise<DriveFileRow | null> {
  const rows = (await tx
    .select({
      id: driveFiles.id,
      parentFolderId: driveFiles.parentFolderId,
      extractedText: driveFiles.extractedText,
      kind: driveFiles.kind,
    })
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.organizationId, organizationId),
        eq(driveFiles.scope, scope),
        eq(driveFiles.scopeId, scopeId),
        eq(driveFiles.path, path),
      ),
    )
    .limit(1)) as unknown as DriveFileRow[]
  return rows[0] ?? null
}

/**
 * Walk the path's parent chain top-down, creating any missing folder rows.
 * Returns the immediate parent folder id (or null when the file lives at
 * scope root).
 */
async function ensureParentFolders(
  tx: TxLike,
  organizationId: string,
  scope: 'organization',
  scopeId: string,
  filePath: string,
): Promise<string | null> {
  const segments = filePath.split('/').filter(Boolean)
  if (segments.length <= 1) return null
  let parentId: string | null = null
  let pathSoFar = ''
  for (let i = 0; i < segments.length - 1; i += 1) {
    pathSoFar += `/${segments[i]}`
    const existing = await getByPath(tx, organizationId, scope, scopeId, pathSoFar)
    if (existing) {
      if (existing.kind !== 'folder') {
        throw validation(
          { path: pathSoFar },
          `drive/changes: path collision — '${pathSoFar}' exists as a file, cannot create folder`,
        )
      }
      parentId = existing.id
      continue
    }
    const id = nanoid(8)
    await tx.insert(driveFiles).values({
      id,
      organizationId,
      scope,
      scopeId,
      parentFolderId: parentId,
      kind: 'folder',
      name: segments[i],
      path: pathSoFar,
      mimeType: null,
      tags: [],
      processingStatus: 'ready',
    })
    parentId = id
  }
  return parentId
}

interface UpsertInput {
  organizationId: string
  scope: 'organization'
  scopeId: string
  path: string
  body: string
  parentFolderId: string | null
  existingId?: string
}

async function upsertFile(tx: TxLike, input: UpsertInput): Promise<{ id: string }> {
  if (input.existingId) {
    await tx
      .update(driveFiles)
      .set({ extractedText: input.body, mimeType: 'text/markdown' })
      .where(eq(driveFiles.id, input.existingId))
    return { id: input.existingId }
  }
  const id = nanoid(8)
  const segments = input.path.split('/').filter(Boolean)
  const name = segments[segments.length - 1] ?? input.path
  await tx.insert(driveFiles).values({
    id,
    organizationId: input.organizationId,
    scope: input.scope,
    scopeId: input.scopeId,
    parentFolderId: input.parentFolderId,
    kind: 'file',
    name,
    path: input.path,
    mimeType: 'text/markdown',
    extractedText: input.body,
    tags: [],
    processingStatus: 'ready',
  })
  return { id }
}
