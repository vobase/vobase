/**
 * `vobase drive …` workspace bash commands.
 *
 * Registered by the agents module's init() via ctx.registerCommand().
 * The dispatcher (vobase-cli/dispatcher.ts) longest-prefix matches `drive propose`
 * before the bare `drive` token, so the two-word name works without ambiguity.
 *
 * Usage:
 *   vobase drive propose --path=/<path> --body="..." [--rationale="..."] [--confidence=0.7]
 */

import { insertProposal } from '@modules/changes/service/proposals'
import { DRIVE_DOC_RESOURCE } from '@modules/drive/service/changes'

import type { CommandDef } from '~/runtime'

/** Parse `--key=value` flags from argv. */
function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/s)
    if (m) {
      flags[m[1]] = m[2]
    }
  }
  return flags
}

export const driveVerbs: readonly CommandDef[] = [
  {
    name: 'drive propose',
    description: 'Propose a change to a organization-drive document (requires staff approval).',
    usage: 'vobase drive propose --path=/<path> --body="..." [--rationale="..."] [--confidence=0.7]',

    async execute(argv, ctx) {
      const flags = parseFlags(argv)

      const path = flags.path
      const body = flags.body

      if (!path) {
        return { ok: false, error: 'missing required flag --path' }
      }
      if (!body) {
        return { ok: false, error: 'missing required flag --body' }
      }
      if (!path.startsWith('/')) {
        return { ok: false, error: '--path must be scope-relative (start with /)' }
      }

      const rationale = flags.rationale
      const confidenceRaw = flags.confidence
      const confidence = confidenceRaw !== undefined ? Number.parseFloat(confidenceRaw) : undefined

      const result = await insertProposal({
        organizationId: ctx.organizationId,
        resourceModule: DRIVE_DOC_RESOURCE.module,
        resourceType: DRIVE_DOC_RESOURCE.type,
        resourceId: path,
        payload: { kind: 'markdown_patch', mode: 'replace', field: 'content', body },
        changedBy: `agent:${ctx.agentId}`,
        changedByKind: 'agent',
        confidence,
        rationale,
        conversationId: ctx.conversationId,
      })

      return {
        ok: true,
        content: `Proposal ${result.id} submitted (status=${result.status}). Staff will review at /api/changes/proposals/${result.id}/decide.`,
      }
    },
  },
]
