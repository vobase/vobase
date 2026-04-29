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

import { deriveUsage } from './derive-usage'
import type { VerbContext } from './transport'

/**
 * A verb result: either structured success data (with optional human summary),
 * or a typed error.
 *
 * `summary` is a one-sentence human-readable confirmation that the in-process
 * transport prefers for bash stdout (e.g. `"Reassigned conversation X → Y"`).
 * HTTP-RPC ignores it — the binary's generic formatter renders `data` via
 * `formatHint`. Verbs migrating from `CommandDef.execute` (which returned a
 * raw string) populate this; pure data-shaped verbs leave it unset.
 */
export type CliVerbResult<T = unknown> =
  | { ok: true; data: T; summary?: string }
  | { ok: false; error: string; errorCode?: string }

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
  /**
   * Hand-authored override for the `--help` / AGENTS.md usage line. Default
   * is auto-derived from `inputSchema` via `deriveUsage()` — set this only
   * when the structural derivation can't express a `.refine`-driven shape
   * (e.g. `--to=<user:<id>|agent:<id>|unassigned>`).
   */
  usage?: string
  /**
   * `true` ⇒ verb body has no observable side effects (pure reads, listings).
   * The in-process transport's `onSideEffect` handler ignores read-only verbs
   * so the wake's "did-something" heuristic doesn't fire for `team list` etc.
   */
  readOnly?: boolean
  /**
   * Which lanes should expose this verb. Default `'all'`.
   *  - `'agent'`: only the in-bash sandbox dispatches it; HTTP-RPC returns
   *    `forbidden` (used for `conv ask-staff`, which only makes sense from a
   *    wake context).
   *  - `'staff'`: only HTTP-RPC dispatches it; the bash sandbox hides it.
   *  - `'all'`: both transports.
   */
  audience?: 'agent' | 'staff' | 'all'
  /**
   * Verb-specific prose for the agent's AGENTS.md `## Commands` block.
   * Rendered under the verb's `### vobase <name>` heading, after `description`
   * and `usage`. Use for workflow guidance ("when to use this", caveats,
   * preferred-over-alternatives) — colocated with the verb body so renames
   * and behaviour changes can't drift from the prompt. Cross-cutting prose
   * that spans multiple verbs still belongs in module `agentsMd` contributors.
   */
  prompt?: string
}

export interface DefineCliVerbOpts<TInput, TOutput> {
  name: string
  description: string
  input: z.ZodType<TInput>
  body: (args: CliVerbBodyArgs<TInput>) => Promise<CliVerbResult<TOutput>>
  formatHint?: string
  rolesAllowed?: readonly string[]
  route?: string
  usage?: string
  readOnly?: boolean
  audience?: 'agent' | 'staff' | 'all'
  prompt?: string
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
    usage: opts.usage ?? deriveUsage(opts.name, opts.input),
    readOnly: opts.readOnly,
    audience: opts.audience,
    prompt: opts.prompt,
  }
}

/** `'contacts list'` ↦ `'/api/cli/contacts/list'`. */
export function defaultRouteForVerb(name: string): string {
  return `/api/cli/${name.trim().split(/\s+/u).join('/')}`
}
