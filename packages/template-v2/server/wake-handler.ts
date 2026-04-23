/**
 * Wake handler — processes `channel-web:inbound-to-wake` jobs by booting a wake
 * via the pi-agent-core harness. Sole consumer of that job; sole producer of
 * agent replies on the web channel.
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
 * One observer is registered: a custom SSE bridge that closes over the real
 * `RealtimeService` so message-producing tool calls fan out to the UI via
 * LISTEN/NOTIFY.
 */

import type { AgentsPort } from '@modules/agents/service/types'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { FilesService } from '@modules/drive/service/files'
import type { Conversation, Message } from '@modules/messaging/schema'
import type { MessagingPort } from '@modules/messaging/service/types'
import { replyTool } from '@modules/messaging/tools/reply'
import { sendCardTool } from '@modules/messaging/tools/send-card'
import type { AgentTool, RealtimeService } from '@server/common/port-types'
import type { SideLoadContributor, WorkspaceMaterializer } from '@server/contracts/side-load'
import { bootWake } from '@server/harness'
import type { AgentObserver } from '@server/harness/internal-bus'
import type { InboundToWakePayload } from '@server/transports/web/jobs'
import { conversationVerbs, driveVerbs, teamVerbs } from '@server/workspace'

interface WakeHandlerDeps {
  messaging: MessagingPort
  contacts: ContactsService
  agents: AgentsPort
  drive: FilesService
  realtime: RealtimeService
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

    // Custom SSE observer — closes over the real realtime service so we don't
    // depend on the harness wiring `ctx.realtime` (it noops by default).
    const sseObserver: AgentObserver = {
      id: 'wake:sse',
      handle(event) {
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
          tools: [replyTool as unknown as AgentTool, sendCardTool as unknown as AgentTool],
          commands: [...teamVerbs, ...conversationVerbs, ...driveVerbs],
          observers: [sseObserver],
          mutators: [],
          materializers: [messagesMaterializer],
          sideLoadContributors: [conversationSideLoad],
        },
        ports: { agents: deps.agents, contacts: deps.contacts, drive: deps.drive },
        logger: {
          debug: () => undefined,
          info: () => undefined,
          warn: (obj, msg) => console.warn('[wake]', msg ?? '', obj),
          error: (obj, msg) => console.error('[wake]', msg ?? '', obj),
        },
        maxTurns: 10,
      })
    } catch (err) {
      console.error('[wake] bootWake failed:', err)
    }
  }
}
