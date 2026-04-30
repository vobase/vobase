import { TZDate } from '@date-fns/tz'
import type { VobaseDb } from '@vobase/core'
import { getCtx, nextSequence, notFound, unauthorized } from '@vobase/core'
import { format, getDay } from 'date-fns'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createConversation, isAgentAssignee, resolveConversation } from '../../messaging/lib/conversation'
import { insertMessage } from '../../messaging/lib/messages'
import { channelInstances, channelRoutings, contacts, conversations, messages } from '../../messaging/schema'
import { cancelWake } from '../lib/agent-wake'
import { agentDefinitions } from '../schema'

const chatSchema = z.object({
  conversationId: z.string().optional(),
  agentId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    }),
  ),
})

/** Mon=A, Tue=B, … Sun=G. Daily-resetting visitor names like "Visitor A001". */
const DAY_LETTERS = ['G', 'A', 'B', 'C', 'D', 'E', 'F'] as const
const DEFAULT_TZ = process.env.TZ || 'Asia/Singapore'

/** Build a timezone-consistent date key + day letter. */
export function visitorDayInfo(now = new Date(), tz = DEFAULT_TZ) {
  const local = new TZDate(now, tz)
  const dateKey = format(local, 'yyyyMMdd')
  const letter = DAY_LETTERS[getDay(local)]
  return { dateKey, letter }
}

async function generateVisitorName(db: VobaseDb): Promise<string> {
  const { dateKey, letter } = visitorDayInfo()
  const seq = await nextSequence(db, `VIS-${letter}-${dateKey}`, {
    padLength: 3,
  })
  // seq = "VIS-A-20260331-001" → extract trailing number
  const num = seq.split('-').pop() ?? ''
  return `Visitor ${letter}${num}`
}

/**
 * Atomic contact upsert keyed by `user:{userId}` identifier.
 * Uses ON CONFLICT so concurrent requests for the same user are safe.
 * Email is intentionally omitted from the insert to avoid unique-constraint
 * collisions when a channel contact already owns that email address.
 */
async function upsertContact(
  db: VobaseDb,
  opts: {
    userId: string
    role?: 'customer' | 'staff'
    name?: string | null
  },
): Promise<string> {
  const identifier = `user:${opts.userId}`

  // Fast path: existing contact — no sequence wasted
  const existing = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.identifier, identifier))
    .limit(1)

  if (existing.length > 0) return existing[0].id

  // Slow path: new contact — generate visitor name then insert with
  // onConflictDoUpdate as a safety net against concurrent first-chat races
  const name = opts.name ?? (opts.role === 'staff' ? null : await generateVisitorName(db))

  const [row] = await db
    .insert(contacts)
    .values({ identifier, name, role: opts.role ?? 'customer' })
    .onConflictDoUpdate({
      target: contacts.identifier,
      set: { updatedAt: new Date() },
    })
    .returning({ id: contacts.id })

  return row.id
}

export const chatHandlers = new Hono()
  /** POST /chat — Web chat: stream agent response. Creates conversation if needed. */
  .post('/chat', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const body = chatSchema.parse(await c.req.json())

    // Validate agent exists
    const [agentDef] = await db
      .select()
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, body.agentId), eq(agentDefinitions.enabled, true)))
    if (!agentDef) throw notFound('Agent not found')

    // Resolve or create conversation
    let conversationId = body.conversationId
    let contactId: string

    if (!conversationId) {
      // New conversation — create contact for authenticated user
      contactId = await upsertContact(db, {
        userId: user.id,
        role: 'staff',
        name: user.name,
      })

      const [webInstance] = await db
        .select()
        .from(channelInstances)
        .where(and(eq(channelInstances.type, 'web'), eq(channelInstances.status, 'active')))

      if (!webInstance) throw notFound('No web channel instance configured')

      let [channelRouting] = await db
        .select()
        .from(channelRoutings)
        .where(
          and(
            eq(channelRoutings.channelInstanceId, webInstance.id),
            eq(channelRoutings.agentId, body.agentId),
            eq(channelRoutings.enabled, true),
          ),
        )

      if (!channelRouting) {
        ;[channelRouting] = await db
          .insert(channelRoutings)
          .values({
            name: `${agentDef.name} - Web`,
            channelInstanceId: webInstance.id,
            agentId: body.agentId,
            assignmentPattern: 'direct',
          })
          .returning()
      }

      const { scheduler, realtime } = getCtx(c)
      const newConversation = await createConversation(
        { db, scheduler, realtime },
        {
          channelRoutingId: channelRouting.id,
          contactId,
          agentId: body.agentId,
          channelInstanceId: webInstance.id,
        },
      )
      conversationId = newConversation.id
    } else {
      // Existing conversation — read contactId + mode in one query
      const [existing] = await db
        .select({
          contactId: conversations.contactId,
          assignee: conversations.assignee,
          onHold: conversations.onHold,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId))

      if (!existing) throw notFound('Conversation not found')

      if (!isAgentAssignee(existing.assignee) || existing.onHold) {
        return c.json(
          {
            error: 'Conversation is assigned to a human or on hold — AI responses are disabled',
          },
          403,
        )
      }

      if (!existing.contactId) throw notFound('Conversation has no contact')
      contactId = existing.contactId
    }

    // Extract last user message
    const lastUserMessage = body.messages.findLast((m) => m.role === 'user')?.content ?? ''

    const { scheduler, realtime } = getCtx(c)

    // Store inbound message in conversation
    if (lastUserMessage) {
      await insertMessage(db, realtime, {
        conversationId,
        messageType: 'incoming',
        contentType: 'text',
        content: lastUserMessage,
        senderId: contactId,
        senderType: 'contact',
        channelType: 'web',
      })
    }

    // Emit typing indicator so frontend knows agent is processing
    await realtime.notify({ table: 'conversations', id: conversationId, action: 'typing' }).catch(() => {})

    // Cancel any running wake that hasn't taken action yet, then schedule a new one.
    // singletonKey deduplicates near-simultaneous HTTP requests. startAfter: 1
    // gives the cancelled wake time to release its advisory lock.
    const agentId = body.agentId
    cancelWake(conversationId)
    await scheduler.add(
      'agents:agent-wake',
      {
        agentId,
        contactId,
        conversationId,
        trigger: 'inbound_message' as const,
      },
      {
        singletonKey: `agents:agent-wake:${agentId}:${conversationId}`,
        startAfter: 1,
      },
    )

    return c.json({ status: 'processing' as const, conversationId })
  })
  /** POST /chat/:channelRoutingId/start — Start or resume a public chat conversation. */
  .post('/chat/:channelRoutingId/start', async (c) => {
    const { db, user, scheduler, realtime } = getCtx(c)
    if (!user) throw unauthorized()
    const channelRoutingId = c.req.param('channelRoutingId')

    // Look up channel routing
    const [channelRouting] = await db
      .select()
      .from(channelRoutings)
      .where(and(eq(channelRoutings.id, channelRoutingId), eq(channelRoutings.enabled, true)))

    if (!channelRouting) throw notFound('Channel routing not found')

    // Look up channel instance
    const [instance] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, channelRouting.channelInstanceId))

    if (!instance) throw notFound('Channel instance not found')

    // Upsert visitor contact from session user
    const contactId = await upsertContact(db, { userId: user.id })

    // Check for existing active conversation for this visitor + channel routing
    const [existingConversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.channelRoutingId, channelRoutingId),
          eq(conversations.contactId, contactId),
          eq(conversations.status, 'active'),
        ),
      )

    if (existingConversation) {
      return c.json({
        conversationId: existingConversation.id,
        agentId: existingConversation.agentId,
      })
    }

    // Create new conversation
    const conversation = await createConversation(
      { db, scheduler, realtime },
      {
        channelRoutingId: channelRouting.id,
        contactId,
        agentId: channelRouting.agentId,
        channelInstanceId: channelRouting.channelInstanceId,
      },
    )

    return c.json({
      conversationId: conversation.id,
      agentId: conversation.agentId,
    })
  })
  /** GET /chat/:channelRoutingId/conversations/:conversationId — Load message history. */
  .get('/chat/:channelRoutingId/conversations/:conversationId', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()
    const channelRoutingId = c.req.param('channelRoutingId')
    const conversationId = c.req.param('conversationId')

    // Verify the conversation belongs to this channel routing
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.channelRoutingId, channelRoutingId)))

    if (!conversation) throw notFound('Conversation not found')

    // Verify visitor owns this conversation
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.identifier, `user:${user.id}`))

    if (!contact || contact.id !== conversation.contactId) throw unauthorized()

    // Load messages from messaging.messages — the source of truth for
    // conversation content. Agents reply via tools (send_reply/send_card)
    // which write here, not to Mastra memory.
    const rows = await db
      .select({
        id: messages.id,
        content: messages.content,
        contentType: messages.contentType,
        contentData: messages.contentData,
        messageType: messages.messageType,
        senderType: messages.senderType,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.private, false)))
      .orderBy(messages.createdAt)

    const chatMessages = rows
      .filter((m) => m.contentType !== 'system')
      .map((m) => {
        const role = m.senderType === 'contact' ? 'user' : m.senderType === 'agent' ? 'assistant' : 'system'

        const parts: Array<{
          type: string
          text?: string
          card?: unknown
          [key: string]: unknown
        }> = []

        if (m.contentType === 'interactive') {
          // Interactive card — include both text and card structure
          if (m.content) parts.push({ type: 'text', text: m.content })
          const data = (m.contentData ?? {}) as Record<string, unknown>
          if (data.card) parts.push({ type: 'card', card: data.card })
        } else if (m.content) {
          parts.push({ type: 'text', text: m.content })
        }

        return {
          id: m.id,
          role,
          parts,
          createdAt: m.createdAt?.toISOString() ?? new Date().toISOString(),
        }
      })

    return c.json({
      id: conversation.id,
      title: null,
      agentId: conversation.agentId,
      messages: chatMessages,
    })
  })
  /** POST /chat/:channelRoutingId/reset — Reset: resolve current conversation + start a new one. */
  .post('/chat/:channelRoutingId/reset', async (c) => {
    const { db, user, scheduler, realtime } = getCtx(c)
    if (!user) throw unauthorized()
    const channelRoutingId = c.req.param('channelRoutingId')

    // Look up channel routing
    const [channelRouting] = await db
      .select()
      .from(channelRoutings)
      .where(and(eq(channelRoutings.id, channelRoutingId), eq(channelRoutings.enabled, true)))

    if (!channelRouting) throw notFound('Channel routing not found')

    // Resolve visitor contact from session
    const contactId = await upsertContact(db, { userId: user.id })

    // Resolve any active conversation for this visitor + channel routing
    const [activeConversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.channelRoutingId, channelRoutingId),
          eq(conversations.contactId, contactId),
          eq(conversations.status, 'active'),
        ),
      )

    if (activeConversation) {
      await resolveConversation(db, activeConversation.id, realtime, 'abandoned')
    }

    // Create fresh conversation
    const conversation = await createConversation(
      { db, scheduler, realtime },
      {
        channelRoutingId: channelRouting.id,
        contactId,
        agentId: channelRouting.agentId,
        channelInstanceId: channelRouting.channelInstanceId,
      },
    )

    return c.json({
      conversationId: conversation.id,
      agentId: conversation.agentId,
    })
  })
  /** POST /chat/:channelRoutingId/send — Send a message in public chat. */
  .post('/chat/:channelRoutingId/send', async (c) => {
    const { db, user, scheduler, realtime } = getCtx(c)
    if (!user) throw unauthorized()
    const channelRoutingId = c.req.param('channelRoutingId')

    // Upsert visitor contact from session
    const contactId = await upsertContact(db, { userId: user.id })

    // Find active or resolving conversation for this visitor + channel routing
    let [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.channelRoutingId, channelRoutingId), eq(conversations.contactId, contactId)))
      .orderBy(desc(conversations.createdAt))
      .limit(1)

    // Auto-create conversation if none exists (e.g. session changed between page load and send)
    if (!conversation || conversation.status === 'resolved' || conversation.status === 'failed') {
      const [channelRouting] = await db
        .select()
        .from(channelRoutings)
        .where(and(eq(channelRoutings.id, channelRoutingId), eq(channelRoutings.enabled, true)))

      if (!channelRouting) throw notFound('Channel routing not found')

      conversation = await createConversation(
        { db, scheduler, realtime },
        {
          channelRoutingId: channelRouting.id,
          contactId,
          agentId: channelRouting.agentId,
          channelInstanceId: channelRouting.channelInstanceId,
        },
      )
    }

    // Reactivate resolving conversations on new inbound message
    if (conversation.status === 'resolving') {
      await db.update(conversations).set({ status: 'active' }).where(eq(conversations.id, conversation.id))
    }

    // Check assignee + hold state
    if (!isAgentAssignee(conversation.assignee) || conversation.onHold) {
      return c.json(
        {
          error: 'Conversation is assigned to a human or on hold — AI responses are disabled',
        },
        403,
      )
    }

    // Parse message content from request body
    const body = z
      .object({
        content: z.string().min(1),
      })
      .parse(await c.req.json())

    // Store inbound message
    await insertMessage(db, realtime, {
      conversationId: conversation.id,
      messageType: 'incoming',
      contentType: 'text',
      content: body.content,
      senderId: contactId,
      senderType: 'contact',
      channelType: 'web',
    })

    // Emit typing indicator
    await realtime.notify({ table: 'conversations', id: conversation.id, action: 'typing' }).catch(() => {})

    // Cancel any running wake that hasn't taken action yet, then schedule a new one
    const agentId = conversation.agentId
    cancelWake(conversation.id)
    await scheduler.add(
      'agents:agent-wake',
      {
        agentId,
        contactId,
        conversationId: conversation.id,
        trigger: 'inbound_message' as const,
      },
      {
        singletonKey: `agents:agent-wake:${agentId}:${conversation.id}`,
        startAfter: 1,
      },
    )

    return c.json({
      status: 'processing' as const,
      conversationId: conversation.id,
    })
  })
