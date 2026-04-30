/**
 * Messages materializer — converts conversation messages from the DB
 * into a human-readable markdown timeline for the agent's virtual filesystem.
 */
import type { VobaseDb } from '@vobase/core'
import { and, desc, eq, ne } from 'drizzle-orm'

import { channelInstances, conversations, messages } from '../../../messaging/schema'

const DEFAULT_LIMIT = 30

interface MessageRow {
  id: string
  senderType: string
  senderId: string
  content: string
  contentType: string
  caption: string | null
  createdAt: Date
}

interface ConversationMeta {
  channelType: string
  status: string
  assignee: string
}

/** Format a Date as `[YYYY-MM-DD HH:MM]` in UTC. */
function formatTimestamp(date: Date): string {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  return `[${y}-${mo}-${d} ${h}:${mi}]`
}

/** Map senderType + senderId to a display name. */
export function formatSender(senderType: string, senderId: string): string {
  switch (senderType) {
    case 'contact':
      return 'Customer'
    case 'agent':
      return 'You'
    case 'user':
      return `[Staff] ${senderId}`
    default:
      return senderId
  }
}

/** Convert a message row to a formatted markdown line. */
function formatMessage(row: MessageRow): string {
  const sender = formatSender(row.senderType, row.senderId)
  const ts = formatTimestamp(row.createdAt)
  const content = formatContent(row)
  return `${ts} ${sender}:\n${content}`
}

/** Build display content based on content type. */
export function formatContent(row: { content: string; contentType: string; caption: string | null }): string {
  switch (row.contentType) {
    case 'text':
    case 'interactive':
      return row.content

    case 'image':
      return row.caption ? `[Image] ${row.caption}` : '[Image]'

    case 'video':
      return row.caption || '(customer sent a video)'

    case 'audio':
      return row.caption || '(customer sent a voice message)'

    case 'document':
      return row.caption ? `[Document] ${row.caption}` : '(customer sent a document)'

    case 'sticker':
      return '(customer sent a sticker)'

    default:
      return row.content
  }
}

/** Fetch conversation metadata (channel type, status, assignee). */
async function fetchConversationMeta(db: VobaseDb, conversationId: string): Promise<ConversationMeta | null> {
  const rows = await db
    .select({
      channelType: channelInstances.type,
      status: conversations.status,
      assignee: conversations.assignee,
    })
    .from(conversations)
    .innerJoin(channelInstances, eq(conversations.channelInstanceId, channelInstances.id))
    .where(eq(conversations.id, conversationId))
    .limit(1)

  return rows[0] ?? null
}

/**
 * Materialize conversation messages into a markdown timeline.
 *
 * Queries the last `limit` messages (excluding system and private),
 * formats them as a human-readable timeline with a header and footer.
 */
export async function materializeMessages(
  db: VobaseDb,
  conversationId: string,
  limit = DEFAULT_LIMIT,
): Promise<string> {
  // Fetch messages and conversation meta in parallel
  const [messageRows, meta] = await Promise.all([
    db
      .select({
        id: messages.id,
        senderType: messages.senderType,
        senderId: messages.senderId,
        content: messages.content,
        contentType: messages.contentType,
        caption: messages.caption,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          ne(messages.contentType, 'system'),
          eq(messages.private, false),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit),
    fetchConversationMeta(db, conversationId),
  ])

  // Reverse to chronological order (query fetches newest-first for correct truncation)
  messageRows.reverse()

  // Build header
  const channelType = meta?.channelType ?? 'unknown'
  const status = meta?.status ?? 'unknown'
  const assignee = meta?.assignee ?? 'unassigned'
  const header = `# Conversation ${conversationId}\nChannel: ${channelType} | Status: ${status} | Assignee: ${assignee}`

  if (messageRows.length === 0) {
    return `${header}\n\n(no messages yet)`
  }

  // Format each message
  const formatted = messageRows.map(formatMessage)

  // Build footer
  const footer =
    messageRows.length >= limit
      ? `(${limit} messages shown. Use 'vobase recall <query>' for older history.)`
      : `(${messageRows.length} messages shown)`

  return `${header}\n\n${formatted.join('\n\n')}\n\n${footer}`
}
