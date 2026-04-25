/**
 * Agent-facing surfaces for the drive module. Materializers only —
 * `/drive/BUSINESS.md` is wake-scoped to the org via the FilesService factory.
 *
 * The row at `scope='organization', path='/BUSINESS.md'` is the source of
 * truth; the materializer falls back to a stub when absent or unreadable.
 *
 * Path is static (`/drive/BUSINESS.md`) but reads depend on the wake's
 * organization scope, so the factory pattern threads the `FilesService`.
 */

import type { FilesService } from '@modules/drive/service/files'
import type { WorkspaceMaterializer } from '@vobase/core'

export const BUSINESS_MD_FALLBACK = `# Business Identity

No business profile configured. Ask staff to create /BUSINESS.md in the drive.
`

/** Read-only slice of FilesService the BUSINESS.md materializer depends on. */
export type DriveReader = Pick<FilesService, 'getByPath' | 'readContent'>

export interface DriveMaterializerOpts {
  drive: DriveReader
}

async function loadBusinessMd(drive: DriveReader): Promise<string> {
  try {
    const row = await drive.getByPath({ scope: 'organization' }, '/BUSINESS.md')
    if (!row) return BUSINESS_MD_FALLBACK
    if (row.extractedText) return row.extractedText
    try {
      const body = await drive.readContent(row.id)
      return body.content || BUSINESS_MD_FALLBACK
    } catch {
      return BUSINESS_MD_FALLBACK
    }
  } catch {
    return BUSINESS_MD_FALLBACK
  }
}

export function buildDriveMaterializers(opts: DriveMaterializerOpts): WorkspaceMaterializer[] {
  return [
    {
      path: '/drive/BUSINESS.md',
      phase: 'frozen',
      materialize: () => loadBusinessMd(opts.drive),
    },
  ]
}

export { buildDriveMaterializers as buildMaterializers }
