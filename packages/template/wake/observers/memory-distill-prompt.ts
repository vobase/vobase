/**
 * `memory.distill` prompt wrapper — Lane B owns per A4. Wraps
 * `PluginContext.llmCall` into a working-memory summariser.
 *
 * Consumed by `~/wake/observers/memory-distill.ts`. Feeds the LLM the
 * accumulated assistant transcript + the current working-memory markdown, and
 * receives a set of `{heading, body}` section upserts — one per relevant topic.
 *
 * Kept tiny on purpose: parse failures return `[]` so a malformed LLM response
 * never crashes a wake (this is a reflection pass, not load-bearing).
 */

import type { LlmRequest, LlmResult } from '~/runtime'

export type LlmCallFn = <T>(task: 'memory.distill', request: LlmRequest) => Promise<LlmResult<T>>

export interface DistillInput {
  /** Ordered assistant turns accumulated during the wake. */
  messages: string[]
  /** Current working-memory markdown (preserves the whole doc for context). */
  currentMemory: string
  /** ISO timestamp for dated section preamble (e.g. "Recent Interaction"). */
  atIso: string
}

export interface DistilledSection {
  heading: string
  body: string
}

export type LlmCall = <T>(task: 'memory.distill', request: LlmRequest) => Promise<LlmResult<T>>

export function buildDistillPrompt(input: DistillInput): { system: string; user: string } {
  const system = [
    "You are `memory.distill`, a post-wake summariser that updates a customer-facing agent's durable working memory.",
    'Return up to 4 sections, each `{heading, body}`. Heading is a short Title Case label ("Recent Interaction", "Customer Preferences", "Open Questions"). Body is plain markdown, ≤ 12 lines.',
    'Respond with JSON only: `{"sections":[{"heading":"...","body":"..."}]}`. If nothing is worth persisting, return `{"sections":[]}`.',
    'Do not re-emit sections already present unless the body materially changes.',
  ].join('\n')

  const user = JSON.stringify(
    {
      at: input.atIso,
      assistantMessages: input.messages,
      currentMemory: input.currentMemory,
    },
    null,
    2,
  )

  return { system, user }
}

/** Call `llmCall('memory.distill', …)` with the built prompt and parse the sections array. */
export async function callMemoryDistill(llmCall: LlmCallFn, input: DistillInput): Promise<DistilledSection[]> {
  const { system, user } = buildDistillPrompt(input)

  const result = await llmCall<string>('memory.distill', {
    system,
    messages: [{ role: 'user', content: user }],
  })

  return parseDistillOutput(result.content)
}

/** Robust parser — tolerates ```json code fences and partial/malformed output. */
export function parseDistillOutput(raw: string): DistilledSection[] {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    return normaliseSections(parsed)
  } catch {
    return []
  }
}

function stripCodeFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? (fenced[1] ?? '').trim() : raw.trim()
}

function normaliseSections(parsed: unknown): DistilledSection[] {
  if (!parsed || typeof parsed !== 'object') return []
  const container = parsed as Record<string, unknown>
  const raw = Array.isArray(container.sections)
    ? container.sections
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : []
  const out: DistilledSection[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    const heading = typeof r.heading === 'string' ? r.heading.trim() : ''
    const body = typeof r.body === 'string' ? r.body : ''
    if (!heading || !body) continue
    out.push({ heading, body })
  }
  return out.slice(0, 4)
}
