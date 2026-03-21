import { getCtx, unauthorized, validation } from '@vobase/core';
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { aiMemCells, aiMemEpisodes, aiMemEventLogs } from './schema';

const scopeSchema = z.union([
  z.string().regex(/^contact:.+/, 'Scope must be contact:ID or user:ID'),
  z.string().regex(/^user:.+/, 'Scope must be contact:ID or user:ID'),
]);

function parseScope(raw: string) {
  const [type, ...rest] = raw.split(':');
  const id = rest.join(':');
  return type === 'contact' ? { contactId: id } : { userId: id };
}

export const aiRoutes = new Hono();

/** GET /memory/stats?scope=contact:ID|user:ID */
aiRoutes.get('/memory/stats', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const rawScope = c.req.query('scope');
  if (!rawScope)
    throw validation({ scope: 'Required. Format: contact:ID or user:ID' });

  const parsed = scopeSchema.safeParse(rawScope);
  if (!parsed.success) throw validation({ scope: parsed.error.message });

  const scope = parseScope(rawScope);

  // Scope is validated — exactly one of contactId/userId is set
  const isContact = 'contactId' in scope;
  const scopeId = isContact ? scope.contactId : scope.userId;
  const cellWhere = isContact
    ? eq(aiMemCells.contactId, scopeId!)
    : eq(aiMemCells.userId, scopeId!);
  const episodeWhere = isContact
    ? eq(aiMemEpisodes.contactId, scopeId!)
    : eq(aiMemEpisodes.userId, scopeId!);
  const factWhere = isContact
    ? eq(aiMemEventLogs.contactId, scopeId!)
    : eq(aiMemEventLogs.userId, scopeId!);

  const [cellCount] = await db
    .select({ count: count() })
    .from(aiMemCells)
    .where(cellWhere);

  const [episodeCount] = await db
    .select({ count: count() })
    .from(aiMemEpisodes)
    .where(episodeWhere);

  const [factCount] = await db
    .select({ count: count() })
    .from(aiMemEventLogs)
    .where(factWhere);

  return c.json({
    cells: cellCount?.count ?? 0,
    episodes: episodeCount?.count ?? 0,
    facts: factCount?.count ?? 0,
  });
});

/** GET /memory/search?q=...&scope=contact:ID|user:ID */
aiRoutes.get('/memory/search', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const rawScope = c.req.query('scope');
  const query = c.req.query('q');
  if (!rawScope)
    throw validation({ scope: 'Required. Format: contact:ID or user:ID' });
  if (!query) throw validation({ q: 'Required. Search query.' });

  const parsed = scopeSchema.safeParse(rawScope);
  if (!parsed.success) throw validation({ scope: parsed.error.message });

  const scope = parseScope(rawScope);

  const { retrieveMemory } = await import('./lib/memory/retriever');
  const result = await retrieveMemory(db, scope, query);
  return c.json(result);
});
