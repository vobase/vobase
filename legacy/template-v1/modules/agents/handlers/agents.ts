import { getCtx, logger, notFound, unauthorized, validation } from '@vobase/core'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireAdmin } from '../../lib/require-admin'
import { resolveAgent } from '../mastra/agents'
import { seedWorkspaceFiles } from '../mastra/workspace/seed-workspace'
import { agentDefinitions, workspaceFiles } from '../schema'

const approvalSchema = z.object({
  agentId: z.string().min(1),
  threadId: z.string().min(1),
  toolCallId: z.string().min(1),
  approved: z.boolean(),
  approvedBy: z.string().optional(),
})

const createAgentSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  channels: z.array(z.string()).optional(),
  mode: z.enum(['full-auto', 'qualify-then-handoff']).optional(),
  suggestions: z.array(z.string()).optional(),
})

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  channels: z.array(z.string()).optional(),
  mode: z.enum(['full-auto', 'qualify-then-handoff']).optional(),
  suggestions: z.array(z.string()).optional(),
})

const fileUpsertSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((p) => !p.includes('..') && !p.startsWith('/'), {
      message: 'Invalid file path',
    }),
  content: z.string(),
})

export const agentsHandlers = new Hono()
  .get('/agents', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const agents = await db
      .select({
        id: agentDefinitions.id,
        name: agentDefinitions.name,
        model: agentDefinitions.model,
        channels: agentDefinitions.channels,
        mode: agentDefinitions.mode,
        suggestions: agentDefinitions.suggestions,
      })
      .from(agentDefinitions)
      .where(eq(agentDefinitions.enabled, true))

    return c.json(agents)
  })
  .get('/agents/:id', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const id = c.req.param('id')

    const [agent] = await db
      .select({
        id: agentDefinitions.id,
        name: agentDefinitions.name,
        model: agentDefinitions.model,
        channels: agentDefinitions.channels,
        mode: agentDefinitions.mode,
        suggestions: agentDefinitions.suggestions,
      })
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, id), eq(agentDefinitions.enabled, true)))

    if (!agent) throw notFound('Agent not found')

    return c.json(agent)
  })
  .post('/agents', requireAdmin(), async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const body = createAgentSchema.parse(await c.req.json())

    const [agent] = await db
      .insert(agentDefinitions)
      .values({
        name: body.name,
        model: body.model,
        ...(body.channels !== undefined && { channels: body.channels }),
        ...(body.mode !== undefined && { mode: body.mode }),
        ...(body.suggestions !== undefined && {
          suggestions: body.suggestions,
        }),
      })
      .returning()

    await seedWorkspaceFiles(db, agent.id)

    return c.json(agent, 201)
  })
  .patch('/agents/:id', requireAdmin(), async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const id = c.req.param('id')
    const body = updateAgentSchema.parse(await c.req.json())

    const [agent] = await db
      .update(agentDefinitions)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.model !== undefined && { model: body.model }),
        ...(body.channels !== undefined && { channels: body.channels }),
        ...(body.mode !== undefined && { mode: body.mode }),
        ...(body.suggestions !== undefined && {
          suggestions: body.suggestions,
        }),
        updatedAt: new Date(),
      })
      .where(eq(agentDefinitions.id, id))
      .returning()

    if (!agent) throw notFound('Agent not found')
    return c.json(agent)
  })
  .delete('/agents/:id', requireAdmin(), async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const id = c.req.param('id')

    const [deleted] = await db
      .update(agentDefinitions)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(agentDefinitions.id, id))
      .returning({ id: agentDefinitions.id })

    if (!deleted) throw notFound('Agent not found')
    return c.json({ ok: true })
  })
  .post('/agents/approve', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const body = approvalSchema.parse(await c.req.json())

    const [agentDef] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, body.agentId))

    if (!agentDef) throw notFound('Agent not found')

    const agent = resolveAgent(agentDef)

    try {
      await agent.resumeGenerate(
        { approved: body.approved, approvedBy: body.approvedBy ?? user.id },
        {
          toolCallId: body.toolCallId,
          memory: {
            thread: body.threadId,
            resource: `thread:${body.threadId}`,
          },
        },
      )

      logger.info('[agents] Tool execution resumed', {
        agentId: body.agentId,
        threadId: body.threadId,
        toolCallId: body.toolCallId,
        approved: body.approved,
      })

      return c.json({ ok: true, approved: body.approved })
    } catch (err) {
      logger.error('[agents] Resume failed', { error: err })
      return c.json({ ok: false, error: 'Failed to resume agent' }, 500)
    }
  })
  .get('/agents/:agentId/files', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()
    const agentId = c.req.param('agentId')

    const files = await db
      .select({
        id: workspaceFiles.id,
        path: workspaceFiles.path,
        writtenBy: workspaceFiles.writtenBy,
        createdAt: workspaceFiles.createdAt,
        updatedAt: workspaceFiles.updatedAt,
      })
      .from(workspaceFiles)
      .where(and(eq(workspaceFiles.agentId, agentId), isNull(workspaceFiles.contactId)))
      .orderBy(workspaceFiles.path)

    return c.json(files)
  })
  .get('/agents/:agentId/file', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()
    const agentId = c.req.param('agentId')
    const path = c.req.query('path')
    if (!path) throw validation({ path: 'Required' })

    const [file] = await db
      .select({
        id: workspaceFiles.id,
        path: workspaceFiles.path,
        content: workspaceFiles.content,
        writtenBy: workspaceFiles.writtenBy,
        updatedAt: workspaceFiles.updatedAt,
      })
      .from(workspaceFiles)
      .where(and(eq(workspaceFiles.agentId, agentId), isNull(workspaceFiles.contactId), eq(workspaceFiles.path, path)))

    if (!file) throw notFound('File not found')
    return c.json(file)
  })
  .put('/agents/:agentId/file', requireAdmin(), async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()
    const agentId = c.req.param('agentId')

    const [agentExists] = await db
      .select({ id: agentDefinitions.id })
      .from(agentDefinitions)
      .where(eq(agentDefinitions.id, agentId))
    if (!agentExists) throw notFound('Agent not found')

    const body = fileUpsertSchema.parse(await c.req.json())

    const [file] = await db
      .insert(workspaceFiles)
      .values({
        agentId,
        contactId: null,
        path: body.path,
        content: body.content,
        writtenBy: 'admin',
      })
      .onConflictDoUpdate({
        target: [workspaceFiles.agentId, workspaceFiles.contactId, workspaceFiles.path],
        set: {
          content: body.content,
          updatedAt: new Date(),
          writtenBy: 'admin',
        },
      })
      .returning({
        id: workspaceFiles.id,
        path: workspaceFiles.path,
        updatedAt: workspaceFiles.updatedAt,
      })

    return c.json(file)
  })
