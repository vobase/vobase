import { getCtx, unauthorized } from '@vobase/core';
import { Hono } from 'hono';

import { listAgents } from '../../../mastra/agents';

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
  });
