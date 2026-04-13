import { channelsTemplates, getCtx, unauthorized } from '@vobase/core';
import { desc } from 'drizzle-orm';
import { Hono } from 'hono';

export const templatesHandlers = new Hono()
  /** GET /templates — List all synced WhatsApp message templates. */
  .get('/templates', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(channelsTemplates)
      .orderBy(desc(channelsTemplates.syncedAt));

    return c.json({ templates: rows });
  });
