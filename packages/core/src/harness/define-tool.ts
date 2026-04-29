/**
 * `defineAgentTool` — typebox-driven helper that collapses the
 * Value.Check + try/catch boilerplate every conversation / standalone tool was
 * repeating verbatim. Each tool declares `{ name, description, schema, lane,
 * errorCode, run }`; the helper handles input validation, error mapping,
 * and the `parallelGroup: 'never'` default.
 *
 * Lives in core because every owning module (messaging, contacts, schedules,
 * channels, …) needs the same helper for its tool definitions.
 */

import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import type { AgentTool, ToolContext, ToolResult } from './types'

export interface DefineAgentToolOpts<TSchemaShape extends TSchema, TOk> {
  name: string
  description: string
  schema: TSchemaShape
  /** Wake-lane partition. Wake builders filter contributions by this field. */
  lane: AgentTool['lane']
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
  /** Forwarded to `AgentTool` — `'customer'` for customer-visible side effects, `'internal'` (default) otherwise. */
  audience?: AgentTool['audience']
  /** Tool-specific prose for the AGENTS.md `## Tool guidance` block. */
  prompt?: string
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
    lane: opts.lane,
    ...(opts.requiresApproval ? { requiresApproval: true } : {}),
    ...(opts.idempotent ? { idempotent: true } : {}),
    ...(typeof opts.maxConcurrent === 'number' ? { maxConcurrent: opts.maxConcurrent } : {}),
    ...(opts.audience ? { audience: opts.audience } : {}),
    ...(opts.prompt ? { prompt: opts.prompt } : {}),
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
