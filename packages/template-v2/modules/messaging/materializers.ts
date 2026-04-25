/**
 * Messaging materializers — render the conversation transcript + internal notes
 * into the virtual workspace so the agent can `cat
 * /contacts/<contactId>/<channelInstanceId>/messages.md`.
 *
 * Declared as wake-time factories because the path encodes `channelInstanceId`,
 * which is only known once the wake resolves its conversation. Factories return
 * plain `WorkspaceMaterializer[]` values — aggregating `MessagingPort` read
 * methods behind the standard `materialize(ctx)` contract.
 */

import type { Message } from '@modules/messaging/schema'
import type { MessagingPort } from '@modules/messaging/service/types'
import type { WorkspaceMaterializer } from '@vobase/core'

export interface MessagingMaterializerOpts {
  messaging: MessagingPort
  contactId: string
  channelInstanceId: string
}

export function renderTranscriptFromMessages(msgs: readonly Message[]): string {
  if (msgs.length === 0) return '# Conversation\n\n_No messages yet._\n'
  const lines = ['# Conversation', '']
  for (const m of msgs) {
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

export async function renderTranscript(messaging: MessagingPort, conversationId: string): Promise<string> {
  const msgs = (await messaging.listMessages(conversationId, { limit: 200 })) as Message[]
  return renderTranscriptFromMessages(msgs)
}

export async function renderInternalNotes(messaging: MessagingPort, conversationId: string): Promise<string> {
  const notes = await messaging.listInternalNotes(conversationId).catch(() => [])
  if (notes.length === 0) return '# Internal Notes\n\n_No notes yet._\n'
  const lines = ['# Internal Notes', '']
  for (const n of notes) {
    const mentions = n.mentions.length > 0 ? ` (@${n.mentions.join(' @')})` : ''
    lines.push(`**${n.authorType}:${n.authorId}** (${new Date(n.createdAt).toISOString()})${mentions}:`)
    lines.push(n.body, '')
  }
  return lines.join('\n')
}

export function buildMessagingMaterializers(opts: MessagingMaterializerOpts): WorkspaceMaterializer[] {
  const folder = `/contacts/${opts.contactId}/${opts.channelInstanceId}`
  return [
    {
      path: `${folder}/messages.md`,
      phase: 'frozen',
      materialize: (ctx) => renderTranscript(opts.messaging, ctx.conversationId),
    },
    {
      path: `${folder}/internal-notes.md`,
      phase: 'frozen',
      materialize: (ctx) => renderInternalNotes(opts.messaging, ctx.conversationId),
    },
  ]
}
