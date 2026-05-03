/**
 * Agent-facing surfaces for the drive module.
 *
 * Materializers render `/drive/BUSINESS.md` from the org-scope drive row
 * (`scope='organization', path='/BUSINESS.md'`). The factory threads the
 * `FilesService` because reads depend on the wake's organization scope.
 *
 * The agent-bash verb `drive propose` now lives as a `defineCliVerb`
 * definition under `./verbs/`. Both the wake's bash sandbox and the runtime
 * CLI binary dispatch through the same `CliVerbRegistry`.
 */

import type { IndexContributor, RoHintFn } from '@vobase/core'
import { defineIndexContributor } from '@vobase/core'

import type { WakeMaterializerFactory } from '~/wake/context'
import type { DriveReader } from './service/types'
import { requestCaptionTool } from './tools/request-caption'

export type { DriveReader }

const AGENTS_MD_FILE = 'AGENTS.md'

/**
 * RO-error hint for `/drive/**`. The drive scope is org-wide read-only to
 * agents — proposals route through `vobase drive propose` for staff review.
 */
export const driveRoHints: RoHintFn[] = [
  (path) => {
    if (path.startsWith('/drive/')) {
      const rel = path.slice('/drive'.length)
      return `bash: ${path}: Read-only filesystem.\n  This path is organization-scope (read-only to agents). Use \`vobase drive propose --scope=organization --path=${rel} --body=...\` to suggest a change for staff review.`
    }
    return null
  },
]

// Cross-cutting prose only — describes the drive FILES the agent reads.
// `drive propose` workflow guidance lives next to the verb body and renders
// under `## Commands` in AGENTS.md.
export const driveAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 30,
    name: 'drive.organization-knowledge',
    render: () =>
      [
        '## Organization knowledge (drive)',
        '',
        '- `/drive/*` — organization knowledge base (read-only). Use `cat`, `grep`, `head` to read.',
        '- `/drive/BUSINESS.md` — organization brand + policies (frozen).',
      ].join('\n'),
  }),
]

export const BUSINESS_MD_FALLBACK = `# Business Identity

No business profile configured. Ask staff to create /BUSINESS.md in the drive.
`

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

/**
 * Drive materializer factory — produces `/drive/BUSINESS.md`. Reads through
 * the wake's `FilesService` so the org-scope drive row is fetched against
 * the right organization.
 */
export const driveMaterializerFactory: WakeMaterializerFactory = (ctx) => [
  {
    path: '/drive/BUSINESS.md',
    phase: 'frozen',
    materialize: () => loadBusinessMd(ctx.drive),
  },
]

export const driveAgent = {
  agentsMd: [...driveAgentsMdContributors],
  materializers: [driveMaterializerFactory],
  roHints: [...driveRoHints],
  tools: [requestCaptionTool],
}
