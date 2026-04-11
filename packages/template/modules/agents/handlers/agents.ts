import { getCtx, logger, notFound, unauthorized } from '@vobase/core';
import { Hono } from 'hono';
import { z } from 'zod';

import { getAgent, listAgents } from '../mastra/agents';

const approvalSchema = z.object({
  agentId: z.string().min(1),
  threadId: z.string().min(1),
  toolCallId: z.string().min(1),
  approved: z.boolean(),
  approvedBy: z.string().optional(),
});

export const agentsHandlers = new Hono()
  /** GET /agents — List available agents from mastra registry. */
  .get('/agents', async (c) => {
    const { user } = getCtx(c);
    if (!user) throw unauthorized();

    const agents = listAgents();
    return c.json(
      agents.map((a) => ({
        id: a.meta.id,
        name: a.meta.name,
        model: a.meta.model,
        channels: a.meta.channels ?? ['web'],
        suggestions: a.meta.suggestions ?? [],
      })),
    );
  })
  /** POST /agents/approve — Resume a suspended tool execution with approval decision. */
  .post('/agents/approve', async (c) => {
    const { user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = approvalSchema.parse(await c.req.json());
    const registered = getAgent(body.agentId);
    if (!registered) throw notFound('Agent not found');

    try {
      await registered.agent.resumeGenerate(
        { approved: body.approved, approvedBy: body.approvedBy ?? user.id },
        {
          toolCallId: body.toolCallId,
          memory: {
            thread: body.threadId,
            resource: `thread:${body.threadId}`,
          },
        },
      );

      logger.info('[agents] Tool execution resumed', {
        agentId: body.agentId,
        threadId: body.threadId,
        toolCallId: body.toolCallId,
        approved: body.approved,
      });

      return c.json({ ok: true, approved: body.approved });
    } catch (err) {
      logger.error('[agents] Resume failed', { error: err });
      return c.json({ ok: false, error: 'Failed to resume agent' }, 500);
    }
  });
