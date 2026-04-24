/**
 * Wake handler — processes `channel-web:inbound-to-wake` jobs by booting a wake
 * via `createHarness` from `@vobase/core`. Sole consumer of that job; sole
 * producer of agent replies on the web channel.
 *
 * Agents only run when the conversation's assignee is an `agent:<id>`. If the
 * assignee is a user or unassigned, the wake is skipped — no fallback agent.
 * The channel instance's `defaultAssignee` config is what seeds this on first
 * inbound (see `server/transports/web/handlers/inbound.ts`).
 *
 * `replyTool` and `sendCardTool` are both registered. The side-load instructs
 * the agent to prefer `send_card` whenever the reply has structure or choices,
 * falling back to `reply` only for pure acknowledgements and free-form
 * questions.
 *
 * Event listeners wired:
 *   - SSE bridge (custom `RealtimeService` notifier)
 *   - Workspace sync (dirty-tracker flush on agent_end)
 *   - Message-history persistence (via `onTurnEndSnapshot`)
 *   - Memory-distill (contact notes + anti-lessons)
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { createMemoryDistillListener } from '@modules/agents/observers/memory-distill'
import { createWorkspaceSyncListener } from '@modules/agents/observers/workspace-sync'
import type { AgentsPort } from '@modules/agents/service/types'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { FilesService } from '@modules/drive/service/files'
import type { Conversation, Message } from '@modules/messaging/schema'
import type { MessagingPort } from '@modules/messaging/service/types'
import { replyTool } from '@modules/messaging/tools/reply'
import { sendCardTool } from '@modules/messaging/tools/send-card'
import type { AgentTool, RealtimeService, ScopedDb } from '@server/common/port-types'
import type { WakeTrigger } from '@server/events'
import { buildFrozenPrompt, type SessionContext } from '@server/harness/frozen-prompt-builder'
import type { LlmEmitter } from '@server/harness/llm-call'
import { createModel, resolveApiKey } from '@server/harness/llm-provider'
import { resolvePlatformHint } from '@server/harness/platform-hints'
import { buildDefaultReadOnlyConfig, conversationVerbs, driveVerbs, teamVerbs } from '@server/workspace'
import { createWorkspace } from '@server/workspace/create-workspace'
import { buildStaffMaterializers, type StaffProfileLookup } from '@server/workspace/staff-materializers'
import type { SideLoadContributor, WorkspaceMaterializer } from '@vobase/core'
import {
  agentMessages,
  conversationEvents,
  createHarness,
  createIdleResumptionContributor,
  DirtyTracker,
  journalGetLastWakeTail,
  loadMessages,
  type OnEventListener,
  resolveThread,
  threads,
} from '@vobase/core'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'

/**
 * Job name + payload for inbound-to-wake dispatch.
 * Producers: `server/transports/web/handlers/{inbound,card-reply}.ts`
 * and `server/transports/whatsapp/service/inbound.ts`.
 * Consumer: `createWakeHandler` below (registered in `server/app.ts`).
 */
export const INBOUND_TO_WAKE_JOB = 'channel-web:inbound-to-wake'

/**
 * Idle-resumption threshold: if the conversation has been quiet longer than
 * this, the side-load injects a `<conversation-idle-resume>` marker so the
 * agent acknowledges the gap instead of assuming conversational recency.
 * 24h matches typical helpdesk "stale thread" semantics.
 */
const IDLE_RESUMPTION_THRESHOLD_MS = 24 * 60 * 60 * 1000

export const InboundToWakePayloadSchema = z.object({
  organizationId: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  contactId: z.string(),
})

export type InboundToWakePayload = z.infer<typeof InboundToWakePayloadSchema>

interface WakeHandlerDeps {
  messaging: MessagingPort
  contacts: ContactsService
  agents: AgentsPort
  drive: FilesService
  realtime: RealtimeService
  /** Optional scoped db — when provided, enables message-history persistence. */
  db?: ScopedDb
}

/**
 * Render the trigger message displayed to the agent as a wake-reason cue.
 *
 * `/contacts/<contactId>/<channelInstanceId>/` replaces the legacy
 * `/conversations/<convId>/` folder for messages + internal-notes references.
 */
function renderTriggerMessage(
  trigger: WakeTrigger | undefined,
  refs: { contactId: string; channelInstanceId: string },
): string {
  if (!trigger) return 'Manual wake.'
  const convoFolder = `/contacts/${refs.contactId}/${refs.channelInstanceId}`
  switch (trigger.trigger) {
    case 'inbound_message':
      return `New customer message(s). See ${convoFolder}/messages.md for context.`
    case 'approval_resumed':
      return trigger.decision === 'approved'
        ? 'Your previous action was approved. Continue.'
        : `Your previous action was rejected: ${trigger.note ?? '(no note)'}. Choose a different approach.`
    case 'supervisor':
      return `Staff added an internal note. Read ${convoFolder}/internal-notes.md for context.`
    case 'scheduled_followup':
      return `Scheduled follow-up: ${trigger.reason}.`
    case 'manual':
      return `Manual wake: ${trigger.reason}.`
    default: {
      const exhaustive: never = trigger
      return `Unknown trigger: ${String(exhaustive)}`
    }
  }
}

export function createWakeHandler(deps: WakeHandlerDeps) {
  return async function handleInboundToWake(rawData: unknown): Promise<void> {
    const data = rawData as InboundToWakePayload
    console.log('[wake] handling inbound→wake', { conv: data.conversationId, msg: data.messageId })

    let conv: Conversation
    try {
      conv = await deps.messaging.getConversation(data.conversationId)
    } catch (err) {
      console.error('[wake] conversation lookup failed:', err)
      return
    }
    if (!conv.assignee.startsWith('agent:')) {
      console.log('[wake] skipping — assignee is not an agent', { assignee: conv.assignee })
      return
    }
    const agentId = conv.assignee.slice('agent:'.length)
    console.log('[wake] booting wake', { agentId, contactId: data.contactId })

    const channelInstanceId = conv.channelInstanceId

    // Render the conversation messages as a markdown transcript.
    const renderTranscript = async (conversationId: string): Promise<string> => {
      const msgs = await deps.messaging.listMessages(conversationId, { limit: 200 })
      if (msgs.length === 0) return '# Conversation\n\n_No messages yet._\n'
      const lines = ['# Conversation', '']
      for (const m of msgs as Message[]) {
        const role = m.role === 'customer' ? 'Customer' : m.role === 'agent' ? 'Agent' : 'System'
        const text =
          m.kind === 'text'
            ? ((m.content as { text?: string }).text ?? '')
            : m.kind === 'card'
              ? `[card: ${JSON.stringify(m.content)}]`
              : m.kind === 'card_reply'
                ? `[card reply: ${JSON.stringify(m.content)}]`
                : `[${m.kind}]`
        lines.push(`**${role}** (${new Date(m.createdAt).toISOString()}):`)
        lines.push(text, '')
      }
      return lines.join('\n')
    }

    // Render internal notes as markdown. Reads the same `listInternalNotes`
    // MessagingPort method used by the notes UI.
    const renderInternalNotes = async (conversationId: string): Promise<string> => {
      const notes = await deps.messaging.listInternalNotes(conversationId).catch(() => [])
      if (notes.length === 0) return '# Internal Notes\n\n_No notes yet._\n'
      const lines = ['# Internal Notes', '']
      for (const n of notes) {
        const mentions = n.mentions.length > 0 ? ` (@${n.mentions.join(' @')})` : ''
        lines.push(`**${n.authorType}:${n.authorId}** (${new Date(n.createdAt).toISOString()})${mentions}:`)
        lines.push(n.body, '')
      }
      return lines.join('\n')
    }

    // Materializers write the transcript + internal notes into the workspace
    // so bash `cat /contacts/<contactId>/<channelInstanceId>/messages.md` works.
    // Side-load contributor pushes the transcript into the first user message
    // so Claude sees the customer question without a bash call on turn 0.
    const contactChannelFolder = `/contacts/${data.contactId}/${channelInstanceId}`
    const messagesMaterializer: WorkspaceMaterializer = {
      path: `${contactChannelFolder}/messages.md`,
      phase: 'frozen',
      materialize: (ctx) => renderTranscript(ctx.conversationId),
    }
    const internalNotesMaterializer: WorkspaceMaterializer = {
      path: `${contactChannelFolder}/internal-notes.md`,
      phase: 'frozen',
      materialize: (ctx) => renderInternalNotes(ctx.conversationId),
    }
    const conversationSideLoad: SideLoadContributor = async (ctx) => {
      const [transcript, contact] = await Promise.all([
        renderTranscript(ctx.conversationId),
        deps.contacts.get(ctx.contactId).catch(() => null),
      ])
      const contactBlock = contact
        ? `# Contact\n\nName: ${contact.displayName ?? '(unknown)'}\nPhone: ${contact.phone ?? ''}\nEmail: ${contact.email ?? ''}\nSegments: ${(contact.segments ?? []).join(', ') || '(none)'}\nNotes:\n${contact.notes || '(empty)'}\n`
        : '# Contact\n\n(no profile)\n'
      const instruction = [
        '# Task',
        '',
        'Respond to the customer now. PREFER `send_card` whenever the reply has any structure or actionable choices — pricing, plans, refund confirmations, yes/no with consequences, 2+ options, next-step CTAs. Use plain `reply` only for pure acknowledgements, free-form questions back to the customer, and single-sentence factual answers with no CTA. Keep prose replies to 2–4 short sentences.',
        '',
        '# Escalation + staff consultation (via bash)',
        '',
        "- `vobase team list` — see who's on the team and their availability/expertise.",
        '- `vobase team get --user=<userId>` — full profile for one staff member.',
        '- `vobase conv reassign --to=user:<userId> [--reason="..."]` — hand off when the customer explicitly asks for a human, or when the request is outside your authority (legal, large refunds, formal complaints). After reassigning, STOP replying — the customer now owns the conversation with that staff member.',
        '- `vobase conv ask-staff --mention=<userId> --body="question"` — post an internal note to ask staff a question you need answered before you can reply. Their reply will wake you again with the answer; in the meantime tell the customer briefly that you\'re checking.',
        '',
        'Before using `conv reassign` or `conv ask-staff`, ALWAYS run `vobase team list` first to get the real userIds. Do NOT invent userIds from names the customer used.',
        '',
        "If the answer depends on pricing or policy details you don't know, prefer `vobase conv ask-staff` over guessing.",
      ].join('\n')
      return [
        { kind: 'custom', priority: 100, render: () => instruction },
        { kind: 'custom', priority: 90, render: () => transcript },
        { kind: 'custom', priority: 80, render: () => contactBlock },
      ]
    }

    // SSE listener — closes over the real realtime service so we don't depend
    // on the harness wiring realtime (it has no such hook anyway).
    const sseListener: OnEventListener<WakeTrigger> = (event) => {
      const anyEv = event as unknown as Record<string, unknown>
      const detail = anyEv.toolName ? ` tool=${anyEv.toolName}` : ''
      const reason = anyEv.reason ? ` reason=${anyEv.reason}` : ''
      const text = anyEv.textDelta ? ` text=${String(anyEv.textDelta).slice(0, 80)}` : ''
      const args = anyEv.args ? ` args=${JSON.stringify(anyEv.args).slice(0, 200)}` : ''
      const result = anyEv.result ? ` result=${JSON.stringify(anyEv.result).slice(0, 200)}` : ''
      const isError = anyEv.isError ? ' ERROR' : ''
      console.log(`[wake] ${event.type} turn=${event.turnIndex}${detail}${reason}${text}${args}${isError}${result}`)
      if (event.type === 'tool_execution_end') {
        deps.realtime.notify({ table: 'messages', id: data.conversationId, action: 'INSERT' })
        deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
      }
    }

    const conversationId = data.conversationId
    const wakeId = nanoid(10)

    try {
      const agentDefinition = await deps.agents.getAgentDefinition(agentId)

      // Which staff to materialize? Scope decision for slice 3d.1b:
      // surface every staff profile in the organization. In dev/seed the staff
      // count is bounded (single-digit); we can tighten to "conversation
      // participants only" later without changing the materializer contract.
      const staffIds = await resolveStaffIdsForOrg(data.organizationId)
      const authLookup = buildAuthLookup(deps.db)
      const staffMaterializers = buildStaffMaterializers({
        organizationId: data.organizationId,
        agentId,
        staffIds,
        authLookup,
      })

      const roConfig = buildDefaultReadOnlyConfig({
        agentId,
        contactId: data.contactId,
        channelInstanceId,
        staffIds,
      })

      // Build workspace (was internal to bootWake).
      const workspace = await createWorkspace({
        organizationId: data.organizationId,
        agentId,
        contactId: data.contactId,
        conversationId,
        channelInstanceId,
        wakeId,
        agentDefinition,
        commands: [...teamVerbs, ...conversationVerbs, ...driveVerbs],
        materializers: [messagesMaterializer, internalNotesMaterializer, ...staffMaterializers],
        drivePort: deps.drive,
        contactsPort: deps.contacts,
        agentsPort: deps.agents,
        readOnlyConfig: roConfig,
      })

      // Resolve session context + platform hint once at wake start; they
      // live in the frozen system prompt and must not change mid-wake.
      const sessionContext = await resolveSessionContext({
        db: deps.db,
        contactsService: deps.contacts,
        conv,
        contactId: data.contactId,
      })
      const platformHint = resolvePlatformHint(sessionContext.channelKind)

      // Frozen system prompt (was internal to bootWake).
      const frozen = await buildFrozenPrompt({
        bash: workspace.bash,
        agentDefinition,
        organizationId: data.organizationId,
        contactId: data.contactId,
        channelInstanceId,
        sessionContext,
        platformHint,
      })

      // Dirty tracker + workspace-sync listener. Writable prefixes + memory
      // paths are taken from the per-wake RO config so we never drift.
      const dirtyTracker = new DirtyTracker(workspace.initialSnapshot, roConfig.writablePrefixes, [
        ...roConfig.memoryPaths,
      ])
      const workspaceSyncListener = createWorkspaceSyncListener({
        fs: workspace.innerFs,
        tracker: dirtyTracker,
        organizationId: data.organizationId,
        agentId,
        contactId: data.contactId,
        drive: deps.drive,
      })

      // Memory-distill listener — closes over the per-wake emitter handle.
      const emitEventHandle: LlmEmitter = {}
      const memoryDistillListener = createMemoryDistillListener({
        target: { kind: 'contact', contactId: data.contactId },
        agentId,
        useLlm: false,
        emitter: emitEventHandle,
      })

      // Optional message-history via onTurnEndSnapshot.
      let threadId: string | null = null
      let seqCursor = 0
      let loadedHistory: readonly AgentMessage[] = []
      if (deps.db) {
        try {
          threadId = await resolveThread(deps.db, { agentId, conversationId })
          const history = await loadMessages(deps.db, threadId)
          loadedHistory = history
          seqCursor = history.length
        } catch (err) {
          console.warn('[wake] message-history setup failed — continuing without persistence', err)
        }
      }

      const trigger: WakeTrigger = {
        trigger: 'inbound_message',
        conversationId,
        messageIds: [data.messageId],
      }

      const model = createModel(agentDefinition.model)

      await createHarness<WakeTrigger>({
        organizationId: data.organizationId,
        agentId,
        contactId: data.contactId,
        conversationId,

        agentDefinition: {
          model: agentDefinition.model,
          instructions: agentDefinition.instructions,
          workingMemory: agentDefinition.workingMemory,
        },
        model,
        getApiKey: () => resolveApiKey(model),

        systemPrompt: frozen.system,
        systemHash: frozen.systemHash,

        trigger,
        triggerKind: trigger.trigger,
        renderTrigger: (t: WakeTrigger | undefined) =>
          renderTriggerMessage(t, { contactId: data.contactId, channelInstanceId }),

        workspace: { bash: workspace.bash, innerFs: workspace.innerFs },

        tools: [replyTool as unknown as AgentTool, sendCardTool as unknown as AgentTool],
        hooks: {
          on_event: [
            sseListener,
            workspaceSyncListener as OnEventListener<WakeTrigger>,
            memoryDistillListener as OnEventListener<WakeTrigger>,
          ],
        },
        materializers: [messagesMaterializer, internalNotesMaterializer, ...staffMaterializers],
        sideLoadContributors: [conversationSideLoad],
        commands: [...teamVerbs, ...conversationVerbs, ...driveVerbs],

        extraCustomSideLoad: deps.db
          ? [
              createIdleResumptionContributor({
                conversationId,
                thresholdMs: IDLE_RESUMPTION_THRESHOLD_MS,
                getLastActivityTime: async (convId) => {
                  const rows = await deps.db
                    ?.select({ ts: conversationEvents.ts })
                    .from(conversationEvents)
                    .where(eq(conversationEvents.conversationId, convId))
                    .orderBy(desc(conversationEvents.ts))
                    .limit(1)
                  return rows && rows.length > 0 ? rows[0].ts : null
                },
              }),
            ]
          : undefined,
        agentsMdChain: {},

        getLastWakeTail: journalGetLastWakeTail,
        journalAppend: async (ev) => {
          await deps.agents.appendEvent(ev as unknown as Parameters<typeof deps.agents.appendEvent>[0])
        },
        loadMessageHistory: loadedHistory.length > 0 ? async () => loadedHistory : undefined,
        onTurnEndSnapshot: async (messages) => {
          if (!deps.db || !threadId) return
          const newMessages = messages.slice(seqCursor)
          if (newMessages.length === 0) return
          const rows = newMessages.map((m, i) => ({
            id: nanoid(10),
            threadId: threadId as string,
            seq: seqCursor + i + 1,
            payload: m as unknown as Record<string, unknown>,
            payloadVersion: 1,
            createdAt: new Date(),
          }))
          await deps.db
            .insert(agentMessages)
            .values(rows)
            .onConflictDoNothing({ target: [agentMessages.threadId, agentMessages.seq] })
          seqCursor += newMessages.length
          await deps.db
            .update(threads)
            .set({ messageCount: seqCursor, lastActiveAt: new Date() })
            .where(eq(threads.id, threadId as string))
        },

        emitEventHandle,

        maxTurns: 10,
        logger: {
          debug: () => undefined,
          info: () => undefined,
          warn: (obj, msg) => console.warn('[wake]', msg ?? '', obj),
          error: (obj, msg) => console.error('[wake]', msg ?? '', obj),
        },
      })
    } catch (err) {
      console.error('[wake] createHarness failed:', err)
    }
  }
}

/**
 * Return the set of staff userIds that should be materialized under
 * `/staff/<id>/` for this wake. Scope decision for slice 3d.1b: enumerate
 * every staff_profiles row for the organization — small N in dev/seed.
 * Silent-fail to `[]` when the team service isn't available yet.
 */
async function resolveStaffIdsForOrg(organizationId: string): Promise<readonly string[]> {
  try {
    const { staff } = await import('@modules/team/service')
    const profiles = await staff.list(organizationId)
    return profiles.map((p) => p.userId)
  } catch {
    return []
  }
}

/**
 * Resolve the session-context snapshot the agent sees at wake start.
 *
 * Reads are best-effort — the frozen prompt section renders with `(unknown)`
 * fallbacks when a lookup fails, keeping the block structurally identical
 * across wakes (prompt-cache stability).
 */
async function resolveSessionContext(input: {
  db: ScopedDb | undefined
  contactsService: ContactsService
  conv: Conversation
  contactId: string
}): Promise<SessionContext> {
  const contact = await input.contactsService.get(input.contactId).catch(() => null)

  let channelKind: string | null = null
  let channelLabel: string | null = null
  let staffAssigneeDisplayName: string | null = null

  if (input.db) {
    try {
      const { channelInstances } = await import('@modules/messaging/schema')
      const rows = await input.db
        .select({ type: channelInstances.type, displayName: channelInstances.displayName })
        .from(channelInstances)
        .where(eq(channelInstances.id, input.conv.channelInstanceId))
        .limit(1)
      const row = rows[0]
      if (row) {
        channelKind = row.type
        channelLabel = row.displayName
      }
    } catch {
      /* swallow — fallback to (unknown) */
    }

    if (input.conv.assignee.startsWith('user:')) {
      try {
        const { authUser } = await import('@vobase/core')
        const userId = input.conv.assignee.slice('user:'.length)
        const rows = await input.db
          .select({ name: authUser.name, email: authUser.email })
          .from(authUser)
          .where(eq(authUser.id, userId))
          .limit(1)
        const row = rows[0]
        if (row) staffAssigneeDisplayName = row.name ?? row.email
      } catch {
        /* swallow */
      }
    }
  }

  return {
    channelKind,
    channelLabel,
    contactDisplayName: contact?.displayName ?? null,
    contactIdentifier: contact?.phone ?? contact?.email ?? null,
    staffAssigneeDisplayName,
    conversationStatus: input.conv.status,
    customerSince: contact?.createdAt ?? null,
  }
}

/** Authenticated-user display fallback for staff profile.md materialization. */
function buildAuthLookup(db: ScopedDb | undefined): StaffProfileLookup {
  if (!db) {
    return {
      async getAuthDisplay() {
        return null
      },
    }
  }
  return {
    async getAuthDisplay(staffId) {
      try {
        const { authUser } = await import('@vobase/core')
        const rows = await db
          .select({ name: authUser.name, email: authUser.email })
          .from(authUser)
          .where(eq(authUser.id, staffId))
          .limit(1)
        const row = rows[0]
        if (!row) return null
        return { name: row.name, email: row.email }
      } catch {
        return null
      }
    },
  }
}
