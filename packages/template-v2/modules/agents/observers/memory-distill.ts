/**
 * memoryDistillObserver — post-wake summarisation stub. Spec §12.1 observer #5.
 *
 * Subscribes to all events during a wake to accumulate assistant messages, then
 * on `agent_end` computes a section diff and upserts the contact's working memory
 * via ContactsPort.upsertWorkingMemorySection.
 *
 * Phase 2 stub behaviour:
 *   - Buffers `message_end` (role=assistant) events per wakeId in-memory.
 *   - On `agent_end`, extracts a "Recent Interaction" section from accumulated
 *     assistant messages (no real LLM call — full `llmCall('memory.distill',…)`
 *     wiring is Phase 3).
 *   - Respects per-contact debounce: fires at most once per 10 min per contact.
 *   - Clears buffer on `agent_end` to prevent memory leaks across wakes.
 *
 * Factory pattern: caller injects `contactId` (wake-scoped); optionally injects
 * a real `llmDistill` fn for Phase 3 upgrade without changing the observer shape.
 */

import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, ObserverContext } from '@server/contracts/observer'

export interface MemoryDistillOpts {
  contactId: string
  /**
   * Optional real LLM distillation fn (Phase 3).
   * If omitted, a deterministic stub is used — suitable for tests.
   */
  llmDistill?: (messages: string[], currentMemory: string) => Promise<Array<{ heading: string; body: string }>>
}

/** Module-level per-contact debounce map. Cleared on process restart (acceptable for Phase 2). */
const lastDistillTs = new Map<string, number>()
const DEBOUNCE_MS = 10 * 60 * 1000

export function createMemoryDistillObserver(opts: MemoryDistillOpts): AgentObserver {
  const { contactId, llmDistill } = opts

  /** Per-wakeId buffer of assistant messages. */
  const wakeMessages = new Map<string, string[]>()

  return {
    id: 'agents:memory-distill',

    async handle(event: AgentEvent, ctx: ObserverContext): Promise<void> {
      // Accumulate assistant messages per wake.
      if (event.type === 'message_end' && event.role === 'assistant' && event.content.trim()) {
        const buf = wakeMessages.get(event.wakeId) ?? []
        buf.push(event.content.trim())
        wakeMessages.set(event.wakeId, buf)
        return
      }

      if (event.type !== 'agent_end') return

      const msgs = wakeMessages.get(event.wakeId) ?? []
      wakeMessages.delete(event.wakeId)

      if (msgs.length === 0) return

      // Debounce: skip if this contact was distilled within the last 10 min.
      const lastTs = lastDistillTs.get(contactId) ?? 0
      const now = Date.now()
      if (now - lastTs < DEBOUNCE_MS) return

      try {
        let sections: Array<{ heading: string; body: string }>

        if (llmDistill) {
          let currentMemory = ''
          try {
            currentMemory = await ctx.ports.contacts.readWorkingMemory(contactId)
          } catch {
            // empty is fine
          }
          sections = await llmDistill(msgs, currentMemory)
        } else {
          // Stub: extract last assistant turn as a dated "Recent Interaction" section.
          sections = stubDistill(msgs, event.ts)
        }

        for (const { heading, body } of sections) {
          await ctx.ports.contacts.upsertWorkingMemorySection(contactId, heading, body)
        }

        lastDistillTs.set(contactId, now)
      } catch (err) {
        ctx.logger.warn({ err, contactId }, 'memory-distill: failed to write distilled sections')
      }
    },
  }
}

/** Deterministic stub: creates a single "Recent Interaction" section from the last assistant message. */
function stubDistill(messages: string[], ts: Date): Array<{ heading: string; body: string }> {
  const last = messages[messages.length - 1] ?? ''
  const preview = last.length > 200 ? `${last.slice(0, 200)}…` : last
  const dateStr = ts.toISOString().slice(0, 10)
  return [{ heading: 'Recent Interaction', body: `_${dateStr}_\n\n${preview}` }]
}
