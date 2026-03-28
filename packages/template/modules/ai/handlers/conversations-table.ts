import { getCtx, unauthorized } from '@vobase/core';
import { Hono } from 'hono';
import SuperJSON from 'superjson';

import { createDrizzleHandler } from '@/lib/drizzle';
import { conversationsTableSchema } from '../lib/table-schemas';
import { conversations } from '../schema';

export const conversationsTableHandlers = new Hono().get('/data', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const handler = createDrizzleHandler({
    // biome-ignore lint/suspicious/noExplicitAny: DrizzleDB generic mismatch with PGlite
    db: db as any,
    table: conversations,
    schema: conversationsTableSchema,
    columnMapping: {
      id: conversations.id,
      status: conversations.status,
      agentId: conversations.agentId,
      channelInstanceId: conversations.channelInstanceId,
      contactId: conversations.contactId,
      startedAt: conversations.startedAt,
      endedAt: conversations.endedAt,
    },
    cursorColumn: 'startedAt',
    defaultSize: 40,
  });

  const search: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(c.req.query())) {
    if (value === '' || value === undefined) continue;

    if (key === 'status' || key === 'agentId') {
      search[key] = value.split(',');
    } else if (key === 'sort') {
      const [id, dir] = value.split('.');
      search[key] = { id, desc: dir === 'desc' };
    } else if (key === 'startedAt') {
      const parts = value.split(',').map(Number);
      search[key] = parts.map((t) => new Date(t));
    } else if (key === 'cursor') {
      search[key] = Number(value);
    } else if (key === 'direction') {
      search[key] = value;
    } else if (key === 'size') {
      search[key] = Number(value);
    } else {
      search[key] = value;
    }
  }

  const result = await handler.execute(search);

  return c.json(
    SuperJSON.serialize({
      data: result.data,
      meta: {
        totalRowCount: result.totalRowCount,
        filterRowCount: result.filterRowCount,
        chartData: [],
        facets: result.facets,
      },
      prevCursor: result.prevCursor,
      nextCursor: result.nextCursor,
    }),
  );
});
