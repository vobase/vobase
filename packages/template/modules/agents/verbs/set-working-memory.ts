/**
 * `vobase agents set-working-memory` — admin verb to overwrite an agent's
 * self-knowledge buffer (`/agents/<id>/MEMORY.md`).
 *
 * Wholesale replacement of the column, not an append. Use for bulk imports
 * or resetting the buffer; in-wake appends still flow through the agent's
 * own `echo ... >> /agents/<id>/MEMORY.md` writes drained by the
 * workspace-sync observer at turn end.
 *
 * `--file=<localPath>` is **client-side**: the CLI binary's resolver reads
 * the operator-local file and rewrites it to `--body=<contents>` before
 * dispatch (see `packages/cli/src/resolver.ts::resolveBodyFrom`). Server-
 * side, only `body` is accepted; the file argument never crosses the wire.
 *
 * Writes go through `agentDefs.update()`; the next wake re-reads
 * `agent_definitions.working_memory` and materializes the updated
 * `/agents/<id>/MEMORY.md` via the standard workspace materializer.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as agentDefs from '../service/agent-definitions'

export const agentsSetWorkingMemoryVerb = defineCliVerb({
  name: 'agents set-working-memory',
  description: "Replace an agent's working memory. Provide --body=<text> or --file=<localPath>.",
  audience: 'admin',
  usage: 'vobase agents set-working-memory --id=<agentId> (--body=<text> | --file=<localPath>)',
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
      const updated = await agentDefs.update(input.id, { workingMemory: input.body })
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
