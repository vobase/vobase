/**
 * learningProposalObserver — observer steps 1-5.
 *
 * Subscribes to every event so it can accumulate the wake's turn history in the
 * same pass that feeds `llmCall('learn.propose', …)`. On `agent_end`:
 *
 *   1. Run `detectStaffSignals(wakeEvents)` — if empty, skip (no-op).
 *   2. Call `ctx.llmCall('learn.propose', …)` with the staff signals, turn
 *      history, existing skills/drive outline, and the agent's working memory
 *      (including `## Anti-lessons` so the LLM dedupes against rejections).
 *   3. For each proposal returned, route by scope:
 *        - contact       → upsert `contact.notes` + insert row status=`auto_written`
 *        - agent_memory  → upsert the agent's workingMemory + insert row status=`auto_written`
 *        - agent_skill   → insert row status=`pending` (staff approval gate)
 *        - drive_doc     → insert row status=`pending` (staff approval gate)
 *   4. Emit `learning_proposed` for every proposal, plus `learning_approved`
 *      (synthetic) for the auto-written scopes.
 *
 * Purity:
 *   - Does NOT mutate the wake it observes (frozen-snapshot invariant). All writes
 *     are post-wake via the ScopedDb handle + ports.
 *   - Buffers events per `wakeId`; clears on `agent_end` to avoid leaks.
 *   - Swallows errors per-proposal — a single bad write can't poison the rest
 *     of the batch, and no error ever propagates back to the harness.
 *
 * Factory pattern mirrors `memory-distill.ts` — caller injects `contactId` +
 * `agentId` (wake-scoped) so the observer can route auto-writes without having
 * to resolve them from the event stream.
 */

import { upsertNotesSection } from '@modules/contacts/service/contacts'
import type { AgentEvent, LearningProposedEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import { llmCall as harnessLlmCall, type LlmEmitter } from '@server/harness/llm-call'
import { getDb, getLogger } from '@server/services'
import { callLearnPropose, type LearningProposalDraft, type LlmCallFn } from '../llm-prompts/learn-propose'
import { append as journalAppend } from '../service/journal'
import { insertProposal } from '../service/learning-proposals'
import { detectStaffSignals } from '../service/staff-signals'

export interface LearningProposalOpts {
  contactId: string
  agentId: string
  /** Per-wake emitter handle so `llm_call` events fired by `learn.propose` surface into the stream. */
  emitter?: LlmEmitter
}

type TurnMessage = { role: 'assistant' | 'user' | 'tool' | 'system'; content: string }

/**
 * Module-scoped accumulator keyed by `wakeId`. Module state is acceptable here
 * because wakeId is globally unique and the buffer is cleared on agent_end —
 * the same pattern memory-distill uses.
 */
const wakeEvents = new Map<string, AgentEvent[]>()
const wakeMessages = new Map<string, TurnMessage[]>()

export function createLearningProposalObserver(opts: LearningProposalOpts): AgentObserver {
  const { contactId, agentId, emitter } = opts

  return {
    id: 'agents:learning-proposal',

    async handle(event: AgentEvent): Promise<void> {
      const buf = wakeEvents.get(event.wakeId) ?? []
      buf.push(event)
      wakeEvents.set(event.wakeId, buf)

      if (event.type === 'message_end') {
        const msgs = wakeMessages.get(event.wakeId) ?? []
        msgs.push({ role: event.role, content: event.content })
        wakeMessages.set(event.wakeId, msgs)
      }

      if (event.type !== 'agent_end') return

      const events = wakeEvents.get(event.wakeId) ?? []
      const history = wakeMessages.get(event.wakeId) ?? []
      wakeEvents.delete(event.wakeId)
      wakeMessages.delete(event.wakeId)

      const signals = detectStaffSignals(events)
      if (signals.length === 0) return

      const logger = getLogger()
      const wake = {
        organizationId: event.organizationId,
        conversationId: event.conversationId,
        wakeId: event.wakeId,
        turnIndex: event.turnIndex,
      }
      const boundLlmCall: LlmCallFn = <T>(
        task: 'learn.propose',
        request: Parameters<typeof harnessLlmCall>[0]['request'],
      ) => harnessLlmCall<T>({ wake, task, request, emitter })

      try {
        await runProposalPass({ event, signals, history, contactId, agentId, llmCall: boundLlmCall })
      } catch (err) {
        logger.warn({ err, wakeId: event.wakeId }, 'learning-proposal: pass failed')
      }
    },
  }
}

interface ProposalPassInput {
  event: Extract<AgentEvent, { type: 'agent_end' }>
  signals: ReturnType<typeof detectStaffSignals>
  history: TurnMessage[]
  contactId: string
  agentId: string
  llmCall: LlmCallFn
}

async function runProposalPass(input: ProposalPassInput): Promise<void> {
  const { event, signals, history, contactId, agentId, llmCall } = input
  const logger = getLogger()

  const { existingSkills, existingDrive, memory } = await gatherProposalContext(agentId, event.organizationId)

  const { proposals } = await callLearnPropose(llmCall, {
    staffSignals: signals,
    turnHistory: history,
    existingSkills,
    existingDrive,
    memory,
    agentId,
    conversationId: event.conversationId,
  })

  for (const draft of proposals) {
    await routeProposal({ event, draft, contactId, agentId }).catch((err) => {
      logger.warn({ err, target: draft.target, scope: draft.scope }, 'learning-proposal: route failed')
    })
  }
}

interface ContextSnapshot {
  existingSkills: Array<{ name: string; description: string }>
  existingDrive: Array<{ path: string; caption: string | null }>
  memory: string
}

async function gatherProposalContext(agentId: string, organizationId: string): Promise<ContextSnapshot> {
  const { learnedSkills, agentDefinitions } = await import('@modules/agents/schema')
  const { and, eq } = await import('drizzle-orm')

  const db = getDb() as unknown as {
    select: (cols?: unknown) => {
      from: (t: unknown) => {
        where: (c: unknown) => {
          limit: (n: number) => Promise<Array<Record<string, unknown>>>
        } & Promise<Array<Record<string, unknown>>>
      }
    }
  }

  const skillRows = (await db
    .select({ name: learnedSkills.name, description: learnedSkills.description })
    .from(learnedSkills)
    .where(and(eq(learnedSkills.organizationId, organizationId), eq(learnedSkills.agentId, agentId)))) as Array<{
    name: string
    description: string
  }>

  const agentRows = (await db
    .select({ workingMemory: agentDefinitions.workingMemory })
    .from(agentDefinitions)
    .where(eq(agentDefinitions.id, agentId))
    .limit(1)) as Array<{ workingMemory: string }>

  return {
    existingSkills: skillRows,
    existingDrive: [],
    memory: agentRows[0]?.workingMemory ?? '',
  }
}

interface RouteInput {
  event: Extract<AgentEvent, { type: 'agent_end' }>
  draft: LearningProposalDraft
  contactId: string
  agentId: string
}

async function routeProposal(input: RouteInput): Promise<void> {
  const { event, draft, contactId, agentId } = input
  const autoWrite = draft.scope === 'contact' || draft.scope === 'agent_memory'

  if (autoWrite) {
    await writeAutoScope(draft, contactId, agentId)
  }

  const { id } = await insertProposal({
    organizationId: event.organizationId,
    conversationId: event.conversationId,
    scope: draft.scope,
    action: draft.action,
    target: draft.target,
    body: draft.body,
    rationale: draft.rationale,
    confidence: draft.confidence,
    status: autoWrite ? 'auto_written' : 'pending',
  })

  const proposedEv: LearningProposedEvent = {
    type: 'learning_proposed',
    ts: new Date(),
    wakeId: event.wakeId,
    conversationId: event.conversationId,
    organizationId: event.organizationId,
    turnIndex: event.turnIndex,
    proposalId: id,
    scope: draft.scope,
  }
  await journalAppend({
    conversationId: proposedEv.conversationId,
    organizationId: proposedEv.organizationId,
    wakeId: proposedEv.wakeId ?? null,
    turnIndex: proposedEv.turnIndex ?? 0,
    event: proposedEv,
  })

  if (autoWrite) {
    const approvedEv = {
      type: 'learning_approved' as const,
      ts: new Date(),
      wakeId: event.wakeId,
      conversationId: event.conversationId,
      organizationId: event.organizationId,
      turnIndex: event.turnIndex,
      proposalId: id,
      writeId: `auto:${id}`,
    }
    await journalAppend({
      conversationId: approvedEv.conversationId,
      organizationId: approvedEv.organizationId,
      wakeId: approvedEv.wakeId,
      turnIndex: approvedEv.turnIndex,
      event: approvedEv,
    })
  }
}

async function writeAutoScope(draft: LearningProposalDraft, contactId: string, agentId: string): Promise<void> {
  if (draft.scope === 'contact') {
    await upsertNotesSection(contactId, draft.target, draft.body)
    return
  }

  if (draft.scope === 'agent_memory') {
    const { agentDefinitions } = await import('@modules/agents/schema')
    const { eq } = await import('drizzle-orm')
    const db = getDb() as unknown as {
      select: () => {
        from: (t: unknown) => {
          where: (c: unknown) => {
            limit: (n: number) => Promise<Array<{ workingMemory: string }>>
          }
        }
      }
      update: (t: unknown) => {
        set: (v: unknown) => { where: (c: unknown) => Promise<void> }
      }
    }
    const rows = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, agentId)).limit(1)
    const current = rows[0]?.workingMemory ?? ''
    const next = upsertMarkdownSection(current, draft.target, draft.body)
    await db.update(agentDefinitions).set({ workingMemory: next }).where(eq(agentDefinitions.id, agentId))
  }
}

/** Upsert a `## <heading>` section into a markdown blob, appending if missing. */
export function upsertMarkdownSection(markdown: string, heading: string, body: string): string {
  const header = `## ${heading}`
  const lines = markdown.split('\n')
  const startIdx = lines.findIndex((l) => l.trim() === header)
  if (startIdx < 0) {
    const trimmed = markdown.trimEnd()
    return trimmed ? `${trimmed}\n\n${header}\n\n${body}\n` : `${header}\n\n${body}\n`
  }
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? '')) {
      endIdx = i
      break
    }
  }
  const before = lines.slice(0, startIdx).join('\n')
  const after = lines.slice(endIdx).join('\n')
  const block = `${header}\n\n${body}\n`
  return [before, block, after]
    .filter((s) => s.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
