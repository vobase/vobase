/**
 * Operator-thread HTTP surface — feeds the right-rail chat and the
 * full-page chat route.
 *
 *   GET  /api/agents/threads                    → list threads owned by the staff
 *   POST /api/agents/threads                    → create a new thread
 *   GET  /api/agents/threads/:id/messages       → list messages in a thread
 *   POST /api/agents/threads/:id/messages       → append a user message + enqueue operator wake
 *
 * The send path writes via `threads.appendMessage` (the sole write path for
 * `agent_thread_messages`) and then enqueues `OPERATOR_THREAD_TO_WAKE_JOB`
 * so the operator wake handler picks it up.
 */

import type { SessionEnv } from '@auth/middleware/require-session'
import { zValidator } from '@hono/zod-validator'
import { requireJobs } from '@modules/agents/service/state'
import { threads as threadsApi } from '@modules/agents/service/threads'
import { Hono } from 'hono'
import { z } from 'zod'

import { OPERATOR_THREAD_TO_WAKE_JOB } from '~/wake/operator-thread'

const createThreadSchema = z.object({
  organizationId: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().max(120).optional(),
  firstMessage: z.string().min(1).optional(),
})

const sendMessageSchema = z.object({
  organizationId: z.string().min(1),
  content: z.string().min(1).max(8000),
})

const app = new Hono<SessionEnv>()
  .get('/threads', async (c) => {
    const userId = c.get('session').user.id
    const organizationId = c.req.query('organizationId')
    if (!organizationId) return c.json({ rows: [] })
    const rows = await threadsApi.listForCreator({ organizationId, createdBy: userId, limit: 50 })
    return c.json({ rows })
  })

  .post('/threads', zValidator('json', createThreadSchema), async (c) => {
    const userId = c.get('session').user.id
    const body = c.req.valid('json')
    const result = await threadsApi.createThread({
      organizationId: body.organizationId,
      agentId: body.agentId,
      createdBy: userId,
      title: body.title ?? null,
      firstMessage: body.firstMessage ? { role: 'user', content: body.firstMessage } : undefined,
    })
    if (body.firstMessage) {
      await requireJobs().send(
        OPERATOR_THREAD_TO_WAKE_JOB,
        { organizationId: body.organizationId, threadId: result.threadId },
        { singletonKey: `operator-thread:${result.threadId}` },
      )
    }
    return c.json({ threadId: result.threadId })
  })

  .get('/threads/:id/messages', async (c) => {
    const threadId = c.req.param('id')
    const rows = await threadsApi.listMessages(threadId)
    return c.json({
      rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    })
  })

  .post('/threads/:id/messages', zValidator('json', sendMessageSchema), async (c) => {
    const threadId = c.req.param('id')
    const body = c.req.valid('json')
    const append = await threadsApi.appendMessage({
      threadId,
      role: 'user',
      content: body.content,
    })
    await requireJobs().send(
      OPERATOR_THREAD_TO_WAKE_JOB,
      { organizationId: body.organizationId, threadId, messageId: append.messageId },
      { singletonKey: `operator-thread:${threadId}` },
    )
    return c.json({ messageId: append.messageId, seq: append.seq })
  })

export default app
