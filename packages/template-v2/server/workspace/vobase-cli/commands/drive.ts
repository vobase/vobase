/**
 * `vobase drive …` CLI verbs — spec §9.2 "Learning proposals" block.
 *
 * Registered by the agents module's init() via ctx.registerCommand().
 * The dispatcher (vobase-cli/dispatcher.ts) longest-prefix matches `drive propose`
 * before the bare `drive` token, so the two-word name works without ambiguity.
 *
 * C4 (plan §8): this file is REQUIRED for the proposal acceptance criterion —
 * without `vobase drive propose`, the proposal-flow test cannot insert rows.
 *
 * Usage:
 *   vobase drive propose --path=/<path> --body="..." [--rationale="..."] [--confidence=0.7]
 */

import { propose } from '@modules/drive/service/proposal'
import type { CommandDef } from '@server/contracts/plugin-context'

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
    description: 'Propose a change to a tenant-drive document (requires staff approval).',
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

      const result = await propose({
        conversationId: ctx.conversationId,
        path,
        body,
        rationale,
        confidence,
      })

      return {
        ok: true,
        content: `Proposal ${result.proposalId} submitted (status=pending). Staff will review at /api/drive/proposals/${result.proposalId}/decide.`,
      }
    },
  },
]
