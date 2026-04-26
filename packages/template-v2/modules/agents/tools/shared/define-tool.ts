/**
 * `defineAgentTool` — typebox-driven helper that collapses the
 * Value.Check + try/catch boilerplate every concierge / operator tool was
 * repeating verbatim. Each tool now declares `{ name, description, schema,
 * errorCode, run }`; the helper handles input validation, error mapping,
 * and the `parallelGroup: 'never'` default.
 */

import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

export interface DefineAgentToolOpts<TSchemaShape extends TSchema, TOk> {
  name: string
  description: string
  schema: TSchemaShape
  /** Error code returned when `run` throws. Validation errors always map to `VALIDATION_ERROR`. */
  errorCode: string
  /** Optional override for `parallelGroup`; defaults to `'never'` (one-at-a-time). */
  parallelGroup?: AgentTool['parallelGroup']
  /** Forwarded to `AgentTool` — when true the harness pauses for staff approval before dispatch. */
  requiresApproval?: boolean
  /** Forwarded to `AgentTool` — when true the harness records an idempotency key on dispatch. */
  idempotent?: boolean
  /** Forwarded to `AgentTool` — per-tool concurrency cap (default 1). */
  maxConcurrent?: number
  /**
   * Executes after validation. Throw to bubble through to `errorCode`;
   * return the success payload otherwise.
   */
  run(args: Static<TSchemaShape>, ctx: ToolContext): Promise<TOk>
}

export function defineAgentTool<TSchemaShape extends TSchema, TOk>(
  opts: DefineAgentToolOpts<TSchemaShape, TOk>,
): AgentTool<Static<TSchemaShape>, TOk> {
  return {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.schema as unknown as AgentTool<Static<TSchemaShape>, TOk>['inputSchema'],
    parallelGroup: opts.parallelGroup ?? 'never',
    ...(opts.requiresApproval ? { requiresApproval: true } : {}),
    ...(opts.idempotent ? { idempotent: true } : {}),
    ...(typeof opts.maxConcurrent === 'number' ? { maxConcurrent: opts.maxConcurrent } : {}),
    async execute(args, ctx: ToolContext): Promise<ToolResult<TOk>> {
      if (!Value.Check(opts.schema, args)) {
        const first = Value.Errors(opts.schema, args).First()
        return {
          ok: false,
          error: `Invalid ${opts.name} input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
          errorCode: 'VALIDATION_ERROR',
        }
      }
      try {
        const content = await opts.run(args as Static<TSchemaShape>, ctx)
        return { ok: true, content }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : `${opts.name} failed`,
          errorCode: opts.errorCode,
        }
      }
    },
  }
}
