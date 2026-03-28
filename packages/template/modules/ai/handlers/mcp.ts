import { getCtx, unauthorized } from '@vobase/core';
import { Hono } from 'hono';

export const mcpHandlers = new Hono()
  /** ALL /mcp — MCP server for AI tools (separate from core's /mcp) */
  .all('/mcp', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const { createAiMcpHandler } = await import('../../../mastra/mcp/server');
    const handler = createAiMcpHandler(db);
    return handler(c.req.raw);
  });
