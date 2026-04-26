/**
 * defineCliVerb — declarative shape for verbs that the catalog endpoint
 * surfaces and any VerbTransport (in-process, HTTP, future MCP) can dispatch.
 *
 * Verb bodies are pure: they receive a parsed input + resolved VerbContext
 * and return a structured result. They never know which transport invoked
 * them. The CLI binary builds its --help, argument validation, and output
 * rendering off the verb's `inputSchema` + `formatHint`.
 *
 * Verb name semantics:
 *  - Multi-word names map to nested CLI groups: `'contacts list'` reads as
 *    `vobase contacts list`. The dispatcher resolves longest-prefix matches,
 *    so `'contacts list pending'` and `'contacts list'` can coexist.
 *  - Names must be unique across all modules; collisions throw at boot.
 *
 * Format hints (optional):
 *  - `'table:cols=id,displayName,phone'` — column-aligned table for arrays
 *  - `'json'` — pretty-printed JSON
 *  - `'lines:field=path'` — one line per array element from `path` field
 *  - omitted: generic-object pretty-print + generic-array count summary
 *
 * `--json` on the CLI overrides the hint and emits raw JSON regardless.
 */

import type { z } from 'zod'

import type { VerbContext } from './transport'

/** A verb result: either structured success data, or a typed error. */
export type CliVerbResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; errorCode?: string }

export interface CliVerbBodyArgs<TInput> {
  input: TInput
  ctx: VerbContext
}

export interface CliVerbDef<TInput = unknown, TOutput = unknown> {
  /** Whitespace-separated multi-word name; `'contacts list'` ↦ `vobase contacts list`. */
  name: string
  description: string
  /** Zod schema validated by the dispatcher *before* `body` runs. */
  inputSchema: z.ZodType<TInput>
  /** The thing the verb does. Pure with respect to the transport. */
  body: (args: CliVerbBodyArgs<TInput>) => Promise<CliVerbResult<TOutput>>
  /** Render hint for the catalog (drives the CLI's generic formatter). */
  formatHint?: string
  /** Roles allowed to invoke. Empty / undefined ⇒ any authenticated principal. */
  rolesAllowed?: readonly string[]
  /** HTTP route the catalog publishes. Defaults to `/api/cli/<name-with-spaces-as-slashes>`. */
  route?: string
}

export interface DefineCliVerbOpts<TInput, TOutput> {
  name: string
  description: string
  input: z.ZodType<TInput>
  body: (args: CliVerbBodyArgs<TInput>) => Promise<CliVerbResult<TOutput>>
  formatHint?: string
  rolesAllowed?: readonly string[]
  route?: string
}

/**
 * Factory that produces a `CliVerbDef`. Keeping the factory thin gives a
 * single place to layer policy (audit hooks, role decoration) without each
 * module open-coding the verb shape.
 */
export function defineCliVerb<TInput, TOutput>(opts: DefineCliVerbOpts<TInput, TOutput>): CliVerbDef<TInput, TOutput> {
  if (opts.name.trim().length === 0) {
    throw new Error('defineCliVerb: name must be non-empty')
  }
  return {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.input,
    body: opts.body,
    formatHint: opts.formatHint,
    rolesAllowed: opts.rolesAllowed,
    route: opts.route ?? defaultRouteForVerb(opts.name),
  }
}

/** `'contacts list'` ↦ `'/api/cli/contacts/list'`. */
export function defaultRouteForVerb(name: string): string {
  return `/api/cli/${name.trim().split(/\s+/u).join('/')}`
}
