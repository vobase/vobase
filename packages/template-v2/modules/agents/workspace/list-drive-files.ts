/**
 * Recursively walk a drive scope and return every file (folders excluded).
 * Used by both `createWorkspace` and `createStandaloneWorkspace` to pre-fetch
 * drive content before mounting it into the agent's virtual filesystem.
 */

import type { DriveFile } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'

export async function listAllDriveFiles(
  drive: FilesService,
  scope: Parameters<FilesService['listFolder']>[0],
): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  const stack: (string | null)[] = [null]
  while (stack.length > 0) {
    const parentId = stack.pop() ?? null
    const entries = await drive.listFolder(scope, parentId).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'folder') stack.push(entry.id)
      else out.push(entry)
    }
  }
  return out
}
