/**
 * Shared building blocks every wake-config flavour assembles. Pure helpers
 * + constants — no per-wake state. Conversation-lane (`./conversation.ts`) and
 * standalone-lane (`./standalone.ts`) flavours both consume these.
 *
 * Frozen-snapshot invariant: anything that lands in `systemPrompt` is computed
 * exactly once per wake. Mid-wake writes (memory, drive proposals, file ops)
 * persist immediately but only surface in the NEXT turn's side-load — the
 * provider's prefix cache is byte-keyed on the prompt.
 */

import type { AgentEvent, WakeTrigger } from '@modules/agents/events'
import * as contactsModule from '@modules/contacts/agent'
import { list as listContacts } from '@modules/contacts/service/contacts'
import * as messagingModule from '@modules/messaging/agent'
import type { Conversation } from '@modules/messaging/schema'
import { list as listConversations } from '@modules/messaging/service/conversations'
import * as schedulesModule from '@modules/schedules/agent'
import { schedules as schedulesService } from '@modules/schedules/service/schedules'
import { staff as teamStaff } from '@modules/team/service'
import type {
  AgentContributions,
  AgentTool,
  HarnessHooks,
  HarnessLogger,
  OnEventListener,
  WorkspaceMaterializer,
} from '@vobase/core'
import { IndexFileBuilder, journalAppend } from '@vobase/core'

import type { RealtimeService, ScopedDb } from '~/runtime'
import type { Capability } from '../capability'

/**
 * Idle-resumption threshold: if the conversation has been quiet longer than
 * this, the side-load injects a `<conversation-idle-resume>` marker so the
 * agent acknowledges the gap instead of assuming conversational recency.
 * 24h matches typical helpdesk "stale thread" semantics.
 */
export const IDLE_RESUMPTION_THRESHOLD_MS = 24 * 60 * 60 * 1000

/** Common per-wake handles passed into both flavours. */
export interface BaseWakeDeps {
  db: ScopedDb
  realtime: RealtimeService
  logger: HarnessLogger
}

/**
 * Return the set of staff userIds materialized under `/staff/<id>/` for this
 * wake — every staff_profiles row in the org. Silent-fails to `[]` when the
 * team service isn't available yet (boot ordering for headless tests).
 */
export async function resolveStaffIdsForOrg(organizationId: string): Promise<readonly string[]> {
  try {
    const profiles = await teamStaff.list(organizationId)
    return profiles.map((p) => p.userId)
  } catch {
    return []
  }
}

/**
 * `/INDEX.md` aggregator. Loads contributors from messaging, schedules, and
 * contacts at materialize-time, registers them with a per-wake builder, and
 * renders the joined document. Empty document → a stable placeholder so the
 * file is always present on the agent's FS.
 *
 * Contributors are pre-baked: each module's loader fetches its data, then
 * returns synchronous `IndexContributor` records that close over it. This
 * keeps `IndexFileBuilder.build()` sync while the materializer itself stays
 * async, matching the existing `WorkspaceMaterializer` shape.
 */
export function buildIndexFileMaterializer(opts: { organizationId: string }): WorkspaceMaterializer {
  return {
    path: '/INDEX.md',
    phase: 'frozen',
    materialize: async () => {
      const conversationsReader = {
        list: (orgId: string, listOpts?: { tab?: 'active' | 'later' | 'done' }): Promise<Conversation[]> =>
          listConversations(orgId, listOpts),
      }
      const [msgContribs, schedContribs, contactContribs] = await Promise.all([
        messagingModule.loadIndexContributors({
          organizationId: opts.organizationId,
          conversations: conversationsReader,
        }),
        schedulesModule.loadIndexContributors({
          organizationId: opts.organizationId,
          schedules: schedulesService,
        }),
        contactsModule.loadIndexContributors({
          organizationId: opts.organizationId,
          contacts: { list: listContacts },
        }),
      ])
      const builder = new IndexFileBuilder().registerAll([...msgContribs, ...schedContribs, ...contactContribs])
      const out = builder.build({ file: 'INDEX.md' })
      return out.length > 0 ? `${out}\n` : '# Index\n\n_No activity yet._\n'
    },
  }
}

/**
 * Per-wake `on_event` listener that mirrors every event to stdout in the
 * `[wake:conv]` / `[wake:solo]` format and (for conversation-lane wakes) emits realtime
 * notifies on `tool_execution_end`. Standalone-lane wakes pass `realtime: null`
 * because their synthetic conversation ids don't map to real DB rows.
 */
export function buildSseListener(opts: {
  /** Log prefix — `'wake:conv'` for conversation-lane, `'wake:solo'` for standalone-lane. */
  logPrefix: 'wake:conv' | 'wake:solo'
  realtime: RealtimeService | null
  /** Real conversation id for realtime notifies. Required iff `realtime` is non-null. */
  conversationId?: string
}): OnEventListener<WakeTrigger> {
  return (event) => {
    const anyEv = event as unknown as Record<string, unknown>
    const detail = anyEv.toolName ? ` tool=${anyEv.toolName}` : ''
    const reason = anyEv.reason ? ` reason=${anyEv.reason}` : ''
    const text = anyEv.textDelta ? ` text=${String(anyEv.textDelta).slice(0, 80)}` : ''
    const args = anyEv.args ? ` args=${JSON.stringify(anyEv.args).slice(0, 200)}` : ''
    const result = anyEv.result ? ` result=${JSON.stringify(anyEv.result).slice(0, 200)}` : ''
    const isError = anyEv.isError ? ' ERROR' : ''
    console.log(
      `[${opts.logPrefix}] ${event.type} turn=${event.turnIndex}${detail}${reason}${text}${args}${isError}${result}`,
    )
    if (event.type === 'tool_execution_end' && opts.realtime && opts.conversationId) {
      opts.realtime.notify({ table: 'messages', id: opts.conversationId, action: 'INSERT' })
      opts.realtime.notify({ table: 'conversations', id: opts.conversationId, action: 'UPDATE' })
    }
  }
}

/**
 * Returns the `journalAppend` adapter every flavour passes into the harness.
 * Both flavours had byte-identical bodies that just unwrapped the AgentEvent
 * fields and forwarded to `journalAppend()`.
 */
export function buildJournalAdapter(): (ev: unknown) => Promise<void> {
  return async (ev: unknown) => {
    const ae = ev as AgentEvent & {
      conversationId: string
      organizationId: string
      wakeId?: string
      turnIndex?: number
    }
    await journalAppend({
      conversationId: ae.conversationId,
      organizationId: ae.organizationId,
      wakeId: ae.wakeId ?? null,
      turnIndex: ae.turnIndex ?? 0,
      event: ae,
    })
  }
}

/**
 * Compose the `tools` array + `hooks` object both lanes assemble identically.
 * Capability tools merge with contributed tools (with an optional filter for
 * the conversation-lane peer-wake guard); lane-owned listeners merge with
 * `contributions.listeners.on_event`; the tool-call / tool-result spreads are
 * honored when present.
 */
export function composeHooks(opts: {
  capability: Capability
  contributions: AgentContributions
  coreListeners: readonly OnEventListener<WakeTrigger>[]
  toolFilter?: (t: AgentTool) => boolean
}): { tools: readonly AgentTool[]; hooks: HarnessHooks<WakeTrigger> } {
  const merged = [...opts.capability.tools, ...(opts.contributions.tools as readonly AgentTool[])]
  const tools = (opts.toolFilter ? merged.filter(opts.toolFilter) : merged) as readonly AgentTool[]
  const hooks: HarnessHooks<WakeTrigger> = {
    on_event: [
      ...opts.coreListeners,
      ...((opts.contributions.listeners.on_event ?? []) as readonly OnEventListener<WakeTrigger>[]),
    ],
    ...(opts.contributions.listeners.on_tool_call ? { on_tool_call: opts.contributions.listeners.on_tool_call } : {}),
    ...(opts.contributions.listeners.on_tool_result
      ? { on_tool_result: opts.contributions.listeners.on_tool_result }
      : {}),
  }
  return { tools, hooks }
}
