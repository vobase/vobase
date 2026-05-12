/**
 * `learning:triage` pg-boss consumer.
 *
 * Ingests signals emitted by wake observers, runs the cheap-model triage pass,
 * applies a 5-min per-(conv, kind) debounce, and inserts a `learning_candidates`
 * row when triage says `worth_attention: true`.
 *
 * Bootstrap registration (consumer start + job name constant export) is wired
 * in US-413 via `runtime/bootstrap.ts`.
 *
 * DB access: singleton-install pattern (`installTriageDeps` / `__resetTriageDepsForTests`)
 * so tests can inject a handle without module init running.
 */

import { agentDefinitions, learningCandidates } from '@modules/agents/schema'
import { insertCandidate } from '@modules/agents/service/learning-candidates'
import { conversationEvents, llmCall as coreLlmCall, type JobDef } from '@vobase/core'
import { and, desc, eq, max } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { createModel, resolveApiKey } from '~/wake/llm'
import { learningThresholds } from './thresholds'
import { type LlmCallFn, runTriage } from './triage-prompt'

// ─── Public types ─────────────────────────────────────────────────────────────

export type LearningSignal =
  | { kind: 'staff_takeover'; messageId: string; body: string }
  | { kind: 'coexistence_echo'; messageId: string; body: string }
  | { kind: 'coaching_note'; noteId: string; body: string }
  | { kind: 'rejection'; proposalId: string; body: string }
  | { kind: 'self_reflection'; wakeId: string; body: string }

export interface LearningTriageJobPayload {
  organizationId: string
  agentId: string
  conversationId: string
  signal: LearningSignal
}

// ─── Job name constant ────────────────────────────────────────────────────────

export const LEARNING_TRIAGE_JOB = 'learning:triage'

// ─── Singleton deps install ───────────────────────────────────────────────────

interface TriageDeps {
  db: ScopedDb
}

let _deps: TriageDeps | null = null

export function installTriageDeps(deps: TriageDeps): void {
  _deps = deps
}

export function __resetTriageDepsForTests(): void {
  _deps = null
}

function getDeps(): TriageDeps {
  if (!_deps) {
    throw new Error('learning:triage — deps not installed. Call installTriageDeps() in bootstrap or module init.')
  }
  return _deps
}

// ─── Signal ref extractor ─────────────────────────────────────────────────────

function signalRef(signal: LearningSignal): string {
  if (signal.kind === 'staff_takeover' || signal.kind === 'coexistence_echo') return signal.messageId
  if (signal.kind === 'coaching_note') return signal.noteId
  if (signal.kind === 'rejection') return signal.proposalId
  return signal.wakeId
}

// ─── LlmCallFn adapter ────────────────────────────────────────────────────────

/**
 * Build a triage-prompt-compatible `LlmCallFn` closure using the module-level
 * provider config (Bifrost or direct). The wake scope passed here is what cost
 * journaling attributes the triage call to — pass the actual tenant + conversation
 * so `tenant_cost_daily` rolls up per-tenant rather than a single 'triage' bucket.
 */
function buildLlmCallFn(scope: { organizationId: string; conversationId: string }): LlmCallFn {
  return async <T>(_task: 'learn.triage', request: Parameters<LlmCallFn>[1]) => {
    const model = createModel(request.model)
    const apiKey = resolveApiKey(model)
    const wake = { ...scope, wakeId: 'triage:0', turnIndex: 0 }
    const res = await coreLlmCall<T>({ wake, task: 'learn.triage', model, apiKey, request })
    return { ...res, task: 'learn.triage' as const }
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleTriageJob(raw: unknown): Promise<void> {
  const payload = raw as LearningTriageJobPayload
  const { organizationId, agentId, conversationId, signal } = payload
  const { db } = getDeps()
  const thresholds = learningThresholds

  // ── a) Debounce check ──────────────────────────────────────────────────────
  const debounceRows = await db
    .select({ lastCreated: max(learningCandidates.createdAt) })
    .from(learningCandidates)
    .where(
      and(
        eq(learningCandidates.organizationId, organizationId),
        eq(learningCandidates.agentId, agentId),
        eq(learningCandidates.conversationId, conversationId),
        eq(learningCandidates.signalKind, signal.kind),
      ),
    )

  const lastCreated = debounceRows[0]?.lastCreated
  if (lastCreated) {
    // Math.abs guards against DB/app clock skew where lastCreated is "in the future"
    // — without it a negative elapsed would always pass the < check and over-debounce.
    const elapsed = Math.abs(Date.now() - lastCreated.getTime())
    if (elapsed < thresholds.triageDebounceMs) {
      console.info(
        { organizationId, agentId, conversationId, signalKind: signal.kind, elapsedMs: elapsed },
        '[learning:triage] debounced — within window',
      )
      return
    }
  }

  // ── b) Load context ────────────────────────────────────────────────────────

  // Journal context: last 10 message events for this conversation
  const journalRows = await db
    .select({ type: conversationEvents.type, role: conversationEvents.role, content: conversationEvents.content })
    .from(conversationEvents)
    .where(eq(conversationEvents.conversationId, conversationId))
    .orderBy(desc(conversationEvents.ts))
    .limit(10)

  const journalContext = journalRows
    .reverse()
    .map((r) => `[${r.type}${r.role ? `/${r.role}` : ''}] ${r.content ?? ''}`.trimEnd())
    .join('\n')
    .slice(0, 2000)

  // Agent working memory head
  const agentRows = await db
    .select({ name: agentDefinitions.name, workingMemory: agentDefinitions.workingMemory })
    .from(agentDefinitions)
    .where(eq(agentDefinitions.id, agentId))
    .limit(1)

  const agentRow = agentRows[0]
  const agentName = agentRow?.name ?? 'Agent'
  const agentMemoryHead = (agentRow?.workingMemory ?? '').slice(0, 500)

  // contactMemoryHead: left undefined for slice 2.
  // Loading it cleanly requires joining conversations -> contacts.memory which
  // pulls in the contacts service as a cross-module dep. Wire in slice 3 when
  // contacts service provides a lightweight readMemoryById(contactId) that can be
  // imported without a full module cycle.

  // ── c) Build TriageInput and run triage ────────────────────────────────────
  const result = await runTriage(buildLlmCallFn({ organizationId, conversationId }), {
    organizationId,
    agentId,
    agentName,
    conversationId,
    signal: { kind: signal.kind, body: signal.body, ref: signalRef(signal) },
    journalContext,
    agentMemoryHead,
  })

  // ── d) Not worth attention — drop ──────────────────────────────────────────
  // `worth_attention` is the LLM's classification; `confidence` is how sure it
  // is of that classification (it can be high while voting "drop").
  if (!result.worth_attention) {
    console.info(
      { signalKind: signal.kind, conversationId, worth_attention: false, confidence: result.confidence },
      '[learning:triage] dropped — triage classified as not worth attention',
    )
    return
  }

  // ── e) Worth attention — insert candidate ─────────────────────────────────
  await insertCandidate({
    organizationId,
    agentId,
    conversationId,
    signalKind: signal.kind,
    signalRef: signalRef(signal),
    triageConfidence: result.confidence,
    scopeHint: result.scope_hint,
    summary: result.summary,
    context: result.context,
  })
}

// ─── Test helper ─────────────────────────────────────────────────────────────

/** Exposed for unit tests only — calls the handler with a typed payload directly. */
export async function handleTriageJobForTest(payload: LearningTriageJobPayload): Promise<void> {
  return handleTriageJob(payload)
}

// ─── JobDef export ────────────────────────────────────────────────────────────

export const learningTriageJob: JobDef = {
  name: LEARNING_TRIAGE_JOB,
  handler: handleTriageJob,
}
