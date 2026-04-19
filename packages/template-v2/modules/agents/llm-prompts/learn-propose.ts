/**
 * `learn.propose` prompt wrapper — Lane B owns per A4 of plan §P3.2 (no edit to
 * `server/runtime/llm-call.ts`; prompt wrappers live in the lane's dispatcher
 * layer). Wraps a `PluginContext.llmCall` into a strongly-typed proposer.
 *
 * Consumed by `modules/agents/observers/learning-proposal.ts`. The observer
 * feeds: (a) the wake's staff signals, (b) a compact turn history, (c) the
 * agent's existing skills + tenant drive outline (for dedup), and (d) the
 * agent's current working memory — including the `## Anti-lessons` section so
 * the LLM has the "don't re-propose X" context (spec §13.1 line 1780).
 *
 * Scope routing (spec §13.1):
 *   - `contact` / `agent_memory` → auto-written
 *   - `agent_skill` / `drive_doc` → staff-approved
 */

import type { LearningAction, LearningScope } from '@server/contracts/domain-types'
import type { LlmRequest, LlmResult, PluginContext } from '@server/contracts/plugin-context'
import type { StaffSignal } from '../service/staff-signals'

export interface ProposeInput {
  staffSignals: StaffSignal[]
  turnHistory: Array<{ role: 'assistant' | 'user' | 'tool' | 'system'; content: string }>
  existingSkills: Array<{ name: string; description: string }>
  existingDrive: Array<{ path: string; caption: string | null }>
  /**
   * Full working-memory markdown as of this wake — including any
   * `## Anti-lessons` section so the LLM has the "don't re-propose X" rule.
   */
  memory: string
  agentId: string
  conversationId: string
}

export interface LearningProposalDraft {
  scope: LearningScope
  action: LearningAction
  target: string
  body: string
  rationale: string
  confidence: number
}

export interface ProposeOutput {
  proposals: LearningProposalDraft[]
}

export type LlmCall = <T>(task: 'learn.propose', request: LlmRequest) => Promise<LlmResult<T>>

/**
 * Build the `learn.propose` system + user messages.
 * Exposed so tests can assert the anti-lesson section + system rule are
 * embedded in the request the LLM would have received.
 */
export function buildProposePrompt(input: ProposeInput): { system: string; user: string } {
  const antiLessonsBlock = extractAntiLessonsSection(input.memory)
  const antiLessonsRule = antiLessonsBlock
    ? `\n\n## Existing anti-lessons (DO NOT re-propose matching topics)\n${antiLessonsBlock}`
    : ''

  const system = [
    'You are `learn.propose`, a reflection pass that converts concentrated staff feedback into durable learning proposals for a customer-facing agent.',
    'Return at most 3 proposals, each with: scope (contact|agent_memory|agent_skill|drive_doc), action (upsert|create|patch), target (scope-relative path or slug), body (markdown), rationale (≤2 sentences), confidence (0..1).',
    'Choose scope conservatively: prefer `contact` for customer-specific facts, `agent_memory` for agent-wide habits, `agent_skill` for reusable procedures, `drive_doc` for shared reference material.',
    'Skip proposals whose target + scope already appears in the anti-lessons section below — rejecting the same topic twice wastes staff attention.',
    antiLessonsRule,
  ].join('\n')

  const user = JSON.stringify(
    {
      staffSignals: input.staffSignals,
      turnHistory: input.turnHistory,
      existingSkills: input.existingSkills,
      existingDrive: input.existingDrive,
      memorySnapshot: input.memory,
      agentId: input.agentId,
      conversationId: input.conversationId,
    },
    null,
    2,
  )

  return { system, user }
}

/** Call `llmCall('learn.propose', …)` with the built prompt and parse the JSON proposals array. */
export async function callLearnPropose(llmCall: PluginContext['llmCall'], input: ProposeInput): Promise<ProposeOutput> {
  const { system, user } = buildProposePrompt(input)

  const result = await llmCall<string>('learn.propose', {
    system,
    messages: [{ role: 'user', content: user }],
  })

  return parseProposeOutput(result.content)
}

/**
 * Parse the LLM's JSON response into a typed `ProposeOutput`. Swallows parse
 * errors (returns zero proposals) so a malformed response never crashes a
 * wake — this is a reflection pass, not load-bearing.
 */
export function parseProposeOutput(raw: string): ProposeOutput {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    const proposals = normalizeProposals(parsed)
    return { proposals }
  } catch {
    return { proposals: [] }
  }
}

function stripCodeFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? (fenced[1] ?? '').trim() : raw.trim()
}

function normalizeProposals(parsed: unknown): LearningProposalDraft[] {
  if (!parsed || typeof parsed !== 'object') return []
  const container = parsed as Record<string, unknown>
  const raw = Array.isArray(container.proposals)
    ? container.proposals
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : []
  const out: LearningProposalDraft[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    const scope = r.scope
    const action = r.action
    if (!isScope(scope) || !isAction(action)) continue
    const target = typeof r.target === 'string' ? r.target : null
    const body = typeof r.body === 'string' ? r.body : null
    if (!target || !body) continue
    const rationale = typeof r.rationale === 'string' ? r.rationale : ''
    const confidence = typeof r.confidence === 'number' ? clamp01(r.confidence) : 0.5
    out.push({ scope, action, target, body, rationale, confidence })
  }
  return out.slice(0, 3)
}

function isScope(s: unknown): s is LearningScope {
  return s === 'contact' || s === 'agent_memory' || s === 'agent_skill' || s === 'drive_doc'
}

function isAction(s: unknown): s is LearningAction {
  return s === 'upsert' || s === 'create' || s === 'patch'
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/** Extract the `## Anti-lessons` section body from a working-memory markdown blob. */
export function extractAntiLessonsSection(memory: string): string {
  const lines = memory.split('\n')
  let inside = false
  const body: string[] = []
  for (const line of lines) {
    if (/^##\s+Anti-lessons\s*$/i.test(line)) {
      inside = true
      continue
    }
    if (inside) {
      if (/^##\s+/.test(line)) break
      body.push(line)
    }
  }
  return body.join('\n').trim()
}
