/**
 * Live agent handler — processes `channel-web:inbound-to-wake` jobs by booting
 * a real Anthropic wake via the pi-agent-core harness.
 *
 * Only `replyTool` is registered. The soul prompt still mentions `send_card`,
 * but Claude can only invoke the tools we actually expose, so it falls back to
 * plain text replies — avoiding the approval/UI loop that `send_card` would
 * trigger. Approval-gated tools remain the right path for staff workflows; for
 * the dev /test-web dogfood we want unblocked round-trips.
 *
 * Multi-turn is now enabled (maxTurns: 10). Message history is persisted via
 * createMessageHistoryObserver when a db handle is supplied to bootWake.
 *
 * One observer is registered: a custom SSE bridge that closes over the real
 * `RealtimeService` so message-producing tool calls fan out to the UI via
 * LISTEN/NOTIFY. Audit + approval are out of scope for the dev path (both
 * require patched `ctx.db`, which the harness only exposes to test helpers).
 */

import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import type { AgentsPort } from '@modules/agents/service/types'
import type { InboundToWakePayload } from '@modules/channels/web/jobs'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { FilesService } from '@modules/drive/service/files'
import type { Conversation, Message } from '@modules/inbox/schema'
import type { InboxPort } from '@modules/inbox/service/types'
import { replyTool } from '@modules/inbox/tools/reply'
import type { AgentObserver } from '@server/contracts/observer'
import type { AgentTool, RealtimeService } from '@server/contracts/plugin-context'
import type { SideLoadContributor, WorkspaceMaterializer } from '@server/contracts/side-load'
import { bootWake } from '@server/harness'

interface LiveAgentDeps {
  inbox: InboxPort
  contacts: ContactsService
  agents: AgentsPort
  drive: FilesService
  realtime: RealtimeService
  /** Retained for API compatibility — the pi-agent-core harness now reads
   *  OPENAI_API_KEY / BIFROST_API_KEY from env via `resolveApiKey()`. */
  anthropicApiKey: string
}

export function createLiveAgentHandler(_deps: LiveAgentDeps) {
  const deps = _deps

  return async function handleInboundToWake(rawData: unknown): Promise<void> {
    const data = rawData as InboundToWakePayload
    console.log('[live-agent] handling inbound→wake', { conv: data.conversationId, msg: data.messageId })

    // Resolve the conversation so we can pick up organizationId + agent assignee.
    let conv: Conversation
    try {
      conv = await deps.inbox.getConversation(data.conversationId)
    } catch (err) {
      console.error('[live-agent] conversation lookup failed:', err)
      return
    }
    const agentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice(6) : MERIDIAN_AGENT_ID
    console.log('[live-agent] booting wake', { agentId, contactId: data.contactId })

    // Render the conversation messages as a markdown transcript.
    const renderTranscript = async (conversationId: string): Promise<string> => {
      const msgs = await deps.inbox.listMessages(conversationId, { limit: 200 })
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

    // Materializer writes the transcript into the workspace so bash `cat
    // /workspace/conversation/messages.md` works. Side-load contributor pushes
    // the same content into the first user message so Claude sees the customer
    // question without a bash call on turn 0.
    const messagesMaterializer: WorkspaceMaterializer = {
      path: '/workspace/conversation/messages.md',
      phase: 'frozen',
      materialize: (ctx) => renderTranscript(ctx.conversationId),
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
        "Respond to the customer now using the `reply` tool. Do NOT use bash to re-explore the workspace — everything you need is already in this message. Keep the reply to 2–4 short sentences. If the answer depends on pricing or policy details you don't know, say so briefly and offer a follow-up.",
      ].join('\n')
      return [
        { kind: 'custom', priority: 100, render: () => instruction },
        { kind: 'custom', priority: 90, render: () => transcript },
        { kind: 'custom', priority: 80, render: () => contactBlock },
      ]
    }

    // Custom SSE observer — closes over the real realtime service so we don't
    // depend on the harness wiring `ctx.realtime` (it noops by default).
    const devSseObserver: AgentObserver = {
      id: 'dev:sse',
      handle(event) {
        // Dev-only trace: summarize each event so we can see what the agent is doing.
        const anyEv = event as unknown as Record<string, unknown>
        const detail = anyEv.toolName ? ` tool=${anyEv.toolName}` : ''
        const reason = anyEv.reason ? ` reason=${anyEv.reason}` : ''
        const text = anyEv.textDelta ? ` text=${String(anyEv.textDelta).slice(0, 80)}` : ''
        const args = anyEv.args ? ` args=${JSON.stringify(anyEv.args).slice(0, 200)}` : ''
        const result = anyEv.result ? ` result=${JSON.stringify(anyEv.result).slice(0, 200)}` : ''
        const isError = anyEv.isError ? ' ERROR' : ''
        console.log(
          `[live-agent] ${event.type} turn=${event.turnIndex}${detail}${reason}${text}${args}${isError}${result}`,
        )
        if (event.type === 'tool_execution_end') {
          deps.realtime.notify({ table: 'messages', id: data.conversationId, action: 'INSERT' })
          deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
        }
      },
    }

    try {
      await bootWake({
        organizationId: data.organizationId,
        agentId,
        contactId: data.contactId,
        conversationId: data.conversationId,
        trigger: {
          trigger: 'inbound_message',
          conversationId: data.conversationId,
          messageIds: [data.messageId],
        },
        registrations: {
          tools: [replyTool as unknown as AgentTool],
          commands: [],
          observers: [devSseObserver],
          mutators: [],
          materializers: [messagesMaterializer],
          sideLoadContributors: [conversationSideLoad],
        },
        ports: { agents: deps.agents, contacts: deps.contacts, drive: deps.drive },
        logger: {
          debug: () => undefined,
          info: () => undefined,
          warn: (obj, msg) => console.warn('[live-agent]', msg ?? '', obj),
          error: (obj, msg) => console.error('[live-agent]', msg ?? '', obj),
        },
        maxTurns: 10,
      })
    } catch (err) {
      console.error('[live-agent] bootWake failed:', err)
    }
  }
}
