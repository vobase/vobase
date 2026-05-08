/**
 * `learn.triage` prompt wrapper — decides whether a learning signal is worth
 * the agent's attention before invoking the more expensive proposal pass.
 *
 * Kept structurally identical to `memory-distill-prompt.ts`:
 * - Pure `buildTriagePrompt` (easy to unit-test)
 * - Stub path for environments without an API key
 * - Code-fence-tolerant `parseTriageOutput` that never crashes a wake
 */

import { listMaterializerRegistrations } from '@modules/changes/service/proposals'

import type { LlmRequest, LlmResult } from '~/runtime'
import { learningThresholds } from './thresholds'

// ─── Public types ─────────────────────────────────────────────────────────────

export type LearningSignalKind =
  | 'staff_takeover'
  | 'coexistence_echo'
  | 'coaching_note'
  | 'rejection'
  | 'self_reflection'

export interface LearningSignalContext {
  kind: LearningSignalKind
  /** Short prose body — the actual signal text (e.g. staff reply, coaching note, rejection note). */
  body: string
  /** Optional ref id for downstream traceability (messageId/noteId/proposalId/wakeId). */
  ref?: string
}

export interface TriageInput {
  organizationId: string
  agentId: string
  agentName: string
  conversationId?: string
  signal: LearningSignalContext
  /** Last ~10 messages of journal context, joined with newlines. Empty string if none. */
  journalContext?: string
  /** First ~500 chars of the agent's working_memory. Empty string if none. */
  agentMemoryHead?: string
  /** First ~500 chars of the contact's memory blob, when scoped to a contact. */
  contactMemoryHead?: string
}

export interface TriageOutput {
  worth_attention: boolean
  scope_hint: string | null // e.g. 'agents.agent_memory' — must be one of the registered scopes
  summary: string // ≤200 chars
  context: string // ≤800 chars
  confidence: number // 0..1
}

export type LlmCallFn = <T = string>(task: 'learn.triage', request: LlmRequest) => Promise<LlmResult<T>>

// ─── Prompt builder ───────────────────────────────────────────────────────────

/** Build the {system, user} prompt pair. Pure — easy to unit-test. */
export function buildTriagePrompt(
  input: TriageInput,
  registeredScopes: ReadonlyArray<{ scope: string; promptHint: string }>,
): { system: string; user: string } {
  const scopeLines = registeredScopes.map((s) => `- ${s.scope}: ${s.promptHint}`).join('\n')

  const system = [
    'You are `learn.triage`, a post-wake signal filter for a customer-facing AI agent.',
    "Decide if the given learning signal is worth the agent's attention — i.e. actionable, non-trivial, and likely to improve future responses.",
    'If worth attention, pick the most likely scope from the registered list below (or null if uncertain).',
    'Registered scopes:',
    scopeLines || '(none registered)',
    '',
    'Return JSON only matching exactly: {"worth_attention": bool, "scope_hint": string|null, "summary": string (≤200 chars), "context": string (≤800 chars), "confidence": number (0..1)}.',
    'If the signal is trivial, too short, or a greeting, set worth_attention=false and confidence≤0.2.',
    'Do not wrap the JSON in code fences. Do not include any other text.',
  ].join('\n')

  const user = JSON.stringify(
    {
      agentName: input.agentName,
      signalKind: input.signal.kind,
      signalBody: input.signal.body,
      signalRef: input.signal.ref ?? null,
      journalContext: input.journalContext ?? '',
      agentMemoryHead: input.agentMemoryHead ?? '',
      contactMemoryHead: input.contactMemoryHead ?? '',
      conversationId: input.conversationId ?? null,
    },
    null,
    2,
  )

  return { system, user }
}

// ─── Stub path ────────────────────────────────────────────────────────────────

/** Stub-mode predicate. Exported for testing. Considers the configured triage model's provider. */
export function shouldStubTriage(): boolean {
  if (process.env.BIFROST_API_KEY) return false
  // Pick the env var that matches the configured triage model's provider.
  const t = learningThresholds.triageModel
  if (t === 'gpt_mini') return !process.env.OPENAI_API_KEY
  if (t === 'claude_haiku') return !process.env.ANTHROPIC_API_KEY
  if (t === 'gemini_flash') return !process.env.GOOGLE_API_KEY
  return true
}

/** Stub output: deterministic. Exported for testing. */
export function stubTriageOutput(input: TriageInput): TriageOutput {
  // Strip leading @<agentName> (case-insensitive) then trim
  const agentNameEscaped = input.agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = input.signal.body.replace(new RegExp(`^@${agentNameEscaped}`, 'i'), '').trim()

  if (stripped.length < 20) {
    return {
      worth_attention: false,
      scope_hint: null,
      summary: input.signal.body.slice(0, 200),
      context: input.signal.body.slice(0, 800),
      confidence: 0.1,
    }
  }

  return {
    worth_attention: true,
    scope_hint: 'agents.agent_memory',
    summary: input.signal.body.slice(0, 200),
    context: input.signal.body.slice(0, 800),
    confidence: 0.5,
  }
}

// ─── Output parser ────────────────────────────────────────────────────────────

const FALLBACK_OUTPUT: TriageOutput = {
  worth_attention: false,
  scope_hint: null,
  summary: '',
  context: '',
  confidence: 0,
}

/** Robust parser. Tolerates code fences. Falls back to worth_attention:false on schema mismatch. */
export function parseTriageOutput(raw: string): TriageOutput {
  try {
    const stripped = stripCodeFence(raw)
    const parsed: unknown = JSON.parse(stripped)
    return normaliseTriageOutput(parsed)
  } catch (err) {
    console.warn('[learn.triage] Failed to parse LLM output:', err, '\nRaw:', raw.slice(0, 200))
    return { ...FALLBACK_OUTPUT }
  }
}

function stripCodeFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? (fenced[1] ?? '').trim() : raw.trim()
}

function normaliseTriageOutput(parsed: unknown): TriageOutput {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn('[learn.triage] Output is not an object')
    return { ...FALLBACK_OUTPUT }
  }

  const r = parsed as Record<string, unknown>

  if (typeof r.worth_attention !== 'boolean') {
    console.warn('[learn.triage] Missing or invalid worth_attention')
    return { ...FALLBACK_OUTPUT }
  }

  const scope_hint =
    r.scope_hint === null || r.scope_hint === undefined ? null : typeof r.scope_hint === 'string' ? r.scope_hint : null
  const summary = typeof r.summary === 'string' ? r.summary : ''
  const context = typeof r.context === 'string' ? r.context : ''

  let confidence = typeof r.confidence === 'number' ? r.confidence : 0
  if (!Number.isFinite(confidence)) confidence = 0
  confidence = Math.min(1, Math.max(0, confidence))

  return {
    worth_attention: r.worth_attention,
    scope_hint,
    summary,
    context,
    confidence,
  }
}

// ─── Top-level runner ─────────────────────────────────────────────────────────

/** Top-level: build prompt, call LLM (or stub), parse output, clamp lengths. */
export async function runTriage(llmCall: LlmCallFn, input: TriageInput): Promise<TriageOutput> {
  if (shouldStubTriage()) {
    return Promise.resolve(stubTriageOutput(input))
  }

  const registrations = listMaterializerRegistrations()
  const registeredScopes = registrations.map((reg) => ({
    scope: `${reg.resourceModule}.${reg.resourceType}`,
    promptHint: reg.promptHint,
  }))

  const { system, user } = buildTriagePrompt(input, registeredScopes)

  const result = await llmCall<string>('learn.triage', {
    system,
    messages: [{ role: 'user', content: user }],
    model: learningThresholds.triageModel,
  })

  const output = parseTriageOutput(result.content)

  // Clamp lengths
  return {
    ...output,
    summary: output.summary.slice(0, 200),
    context: output.context.slice(0, 800),
  }
}
