/**
 * memoryDistillObserver — post-wake summarisation + anti-lessons feedback loop.
 * On `agent_end`: appends rejection reasons to the agent's `## Anti-lessons`
 * section so the next turn sees them, then (when the per-contact debounce has
 * elapsed) distills assistant messages into `ContactsService` notes sections
 * via `llmCall('memory.distill', …)` — or the deterministic stub when no
 * provider is wired.
 */

import {
  readNotes as readContactNotes,
  upsertNotesSection as upsertContactNotesSection,
} from '@modules/contacts/service/contacts'
import { readNotes as readStaffNotes, upsertNotesSection as upsertStaffNotesSection } from '@modules/team/service/staff'
import type { AgentEvent, LearningRejectedEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import { llmCall as harnessLlmCall, type LlmEmitter } from '@server/harness/llm-call'
import { getDb, getLogger } from '@server/services'
import { callMemoryDistill, type DistilledSection } from '../llm-prompts/memory-distill'
import { upsertMarkdownSection } from './learning-proposal'

/**
 * Target for distilled-memory writes. Contact target writes to
 * `contacts.notes` (aka Drive `contact:/NOTES.md`); staff target writes to
 * `staff_profiles.notes` (aka Drive `staff:/NOTES.md`).
 */
export type DistillTarget = { kind: 'contact'; contactId: string } | { kind: 'staff'; userId: string }

export interface MemoryDistillOpts {
  target: DistillTarget
  agentId?: string
  /** When set, fires `llmCall('memory.distill', …)` instead of the deterministic stub. */
  useLlm?: boolean
  /** Per-wake emitter handle (from `createHarness({ emitEventHandle })`) so `llm_call` events surface. */
  emitter?: LlmEmitter
}

/** Module-level per-target debounce map. Cleared on process restart (acceptable for Phase 2). */
const lastDistillTs = new Map<string, number>()
const DEBOUNCE_MS = 10 * 60 * 1000

function targetKey(t: DistillTarget): string {
  return t.kind === 'contact' ? `contact:${t.contactId}` : `staff:${t.userId}`
}

async function readTargetNotes(t: DistillTarget): Promise<string> {
  return t.kind === 'contact' ? readContactNotes(t.contactId) : readStaffNotes(t.userId)
}

async function upsertTargetNotesSection(t: DistillTarget, heading: string, body: string): Promise<void> {
  if (t.kind === 'contact') {
    await upsertContactNotesSection(t.contactId, heading, body)
  } else {
    await upsertStaffNotesSection(t.userId, heading, body)
  }
}

interface WakeBuffer {
  assistantMessages: string[]
  rejections: LearningRejectedEvent[]
}

export function createMemoryDistillObserver(opts: MemoryDistillOpts): AgentObserver {
  const { target, agentId, useLlm, emitter } = opts
  const tkey = targetKey(target)

  const wakeBuffer = new Map<string, WakeBuffer>()

  return {
    id: 'agents:memory-distill',

    async handle(event: AgentEvent): Promise<void> {
      const logger = getLogger()
      const buf = wakeBuffer.get(event.wakeId) ?? { assistantMessages: [], rejections: [] }

      if (event.type === 'message_end' && event.role === 'assistant' && event.content.trim()) {
        buf.assistantMessages.push(event.content.trim())
        wakeBuffer.set(event.wakeId, buf)
        return
      }

      if (event.type === 'learning_rejected') {
        buf.rejections.push(event)
        wakeBuffer.set(event.wakeId, buf)
        return
      }

      if (event.type !== 'agent_end') return

      const state = wakeBuffer.get(event.wakeId) ?? buf
      wakeBuffer.delete(event.wakeId)

      if (state.rejections.length > 0 && agentId) {
        await writeAntiLessons(agentId, state.rejections).catch((err) =>
          logger.warn({ err, agentId }, 'memory-distill: anti-lesson write failed'),
        )
      }

      if (state.assistantMessages.length === 0) return

      const lastTs = lastDistillTs.get(tkey) ?? 0
      const now = Date.now()
      if (now - lastTs < DEBOUNCE_MS) return

      try {
        let sections: DistilledSection[]
        if (useLlm) {
          const currentMemory = await readMemorySafe(target)
          const wake = {
            organizationId: event.organizationId,
            conversationId: event.conversationId,
            wakeId: event.wakeId,
            turnIndex: event.turnIndex,
          }
          const bound = <T>(task: 'memory.distill', request: Parameters<typeof harnessLlmCall>[0]['request']) =>
            harnessLlmCall<T>({ wake, task, request, emitter })
          sections = await callMemoryDistill(bound, {
            messages: state.assistantMessages,
            currentMemory,
            atIso: event.ts.toISOString(),
          })
        } else {
          sections = stubDistill(state.assistantMessages, event.ts)
        }

        for (const { heading, body } of sections) {
          await upsertTargetNotesSection(target, heading, body)
        }

        lastDistillTs.set(tkey, now)
      } catch (err) {
        logger.warn({ err, target }, 'memory-distill: failed to write distilled sections')
      }
    },
  }
}

async function readMemorySafe(target: DistillTarget): Promise<string> {
  try {
    return await readTargetNotes(target)
  } catch {
    return ''
  }
}

async function writeAntiLessons(agentId: string, rejections: LearningRejectedEvent[]): Promise<void> {
  const { agentDefinitions, learningProposals } = await import('@modules/agents/schema')
  const { eq, inArray } = await import('drizzle-orm')

  const db = getDb()
  const proposalIds = rejections.map((r) => r.proposalId)

  const [rows, agentRows] = (await Promise.all([
    db
      .select({
        id: learningProposals.id,
        target: learningProposals.target,
        scope: learningProposals.scope,
        decidedNote: learningProposals.decidedNote,
        decidedAt: learningProposals.decidedAt,
      })
      .from(learningProposals)
      .where(inArray(learningProposals.id, proposalIds)),
    db.select().from(agentDefinitions).where(eq(agentDefinitions.id, agentId)).limit(1),
  ])) as [
    Array<{ id: string; target: string; scope: string; decidedNote: string | null; decidedAt: Date | null }>,
    Array<{ workingMemory: string }>,
  ]

  if (rows.length === 0) return

  const current = agentRows[0]?.workingMemory ?? ''

  const existingBody = extractAntiLessonsBody(current)
  const existingIds = extractAntiLessonProposalIds(existingBody)
  const newEntries = rows
    .filter((r) => !existingIds.has(r.id))
    .map(
      (r) =>
        `- \`[${r.id}]\` **${r.scope}:${r.target}** — ${r.decidedNote ?? 'no reason given'} _(rejected ${(r.decidedAt ?? new Date()).toISOString()})_`,
    )
  if (newEntries.length === 0) return

  const mergedBody = existingBody ? `${existingBody}\n${newEntries.join('\n')}` : newEntries.join('\n')
  const next = upsertMarkdownSection(current, 'Anti-lessons', mergedBody)
  await db.update(agentDefinitions).set({ workingMemory: next }).where(eq(agentDefinitions.id, agentId))
}

/** Each rendered line embeds `` `[<proposalId>]` `` so a repeat rejection is a no-op. */
function extractAntiLessonProposalIds(body: string): Set<string> {
  const ids = new Set<string>()
  const marker = /`\[([^\]]+)\]`/g
  for (const match of body.matchAll(marker)) {
    if (match[1]) ids.add(match[1])
  }
  return ids
}

function extractAntiLessonsBody(memory: string): string {
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

/** Deterministic stub: creates a single "Recent Interaction" section from the last assistant message. */
function stubDistill(messages: string[], ts: Date): DistilledSection[] {
  const last = messages[messages.length - 1] ?? ''
  const preview = last.length > 200 ? `${last.slice(0, 200)}…` : last
  const dateStr = ts.toISOString().slice(0, 10)
  return [{ heading: 'Recent Interaction', body: `_${dateStr}_\n\n${preview}` }]
}
