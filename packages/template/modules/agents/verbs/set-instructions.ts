/**
 * `vobase agents set-instructions` — admin verb to overwrite an agent's
 * persistent instructions (the "frozen-once-per-wake" preamble baked into
 * every system prompt for that agent).
 *
 * `--file=<localPath>` is **client-side**: the CLI binary's resolver reads
 * the operator-local file and rewrites it to `--body=<contents>` before
 * dispatch (mirroring `drive upload`'s base64 trick, see
 * `packages/cli/src/resolver.ts::resolveBodyFrom`). The verb itself only
 * accepts `body: string`, so the server-side code path never touches the
 * operator's filesystem.
 *
 * `defineCliVerb` superRefine enforces `body` XOR `file`; the resolver
 * strips `file` before the body hits Zod, so server-side we only validate
 * `body` is present + non-empty.
 *
 * Writes go through `agentDefs.update()` — the same writer the web admin
 * UI uses. The next wake re-reads `agent_definitions` and picks up the new
 * value with no further wiring (definitions are not cached in-memory).
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as agentDefs from '../service/agent-definitions'

export const agentsSetInstructionsVerb = defineCliVerb({
  name: 'agents set-instructions',
  description: "Replace an agent's instructions (system-prompt preamble). Provide --body=<text> or --file=<localPath>.",
  audience: 'admin',
  usage: 'vobase agents set-instructions --id=<agentId> (--body=<text> | --file=<localPath>)',
  input: z.object({
    id: z.string().min(1),
    /** The resolver translates `--file=<path>` into `body=<contents>` client-side. */
    body: z.string().min(1, '--body or --file is required and must be non-empty'),
  }),
  body: async ({ input, ctx }) => {
    try {
      const existing = await agentDefs.getById(input.id)
      if (existing.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'agent not in this organization', errorCode: 'forbidden' }
      }
      const updated = await agentDefs.update(input.id, { instructions: input.body })
      return {
        ok: true as const,
        data: { id: updated.id, name: updated.name, updatedAt: updated.updatedAt, bytes: input.body.length },
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'update_failed',
      }
    }
  },
  formatHint: 'json',
})
