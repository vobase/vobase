import { and, desc, eq, lt } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Auth } from '../auth';
import { getCtx } from '../ctx';
import { sessionMiddleware } from '../middleware/session';
import { auditLog, recordAudits, sequences } from './schema';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SYSTEM_VERSION = '0.1.0';

function parseLimit(rawLimit: string | undefined): number {
  const parsed = Number(rawLimit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function parseCursor(rawCursor: string | undefined): Date | null {
  if (!rawCursor) {
    return null;
  }

  const timestamp = Number(rawCursor);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createSystemRoutes(auth: Auth): Hono {
  const routes = new Hono({ strict: false });

  routes.use('*', sessionMiddleware(auth));

  routes.get('/', (c) => {
    return c.json({ version: SYSTEM_VERSION, uptime: process.uptime(), modules: ['system'] });
  });

  routes.get('/health', (c) => {
    return c.json({ status: 'ok', db: 'ok', uptime: process.uptime() });
  });

  routes.get('/audit-log', (c) => {
    const { db } = getCtx(c);
    const limit = parseLimit(c.req.query('limit'));
    const cursor = parseCursor(c.req.query('cursor'));

    const entries = (cursor
      ? db
          .select()
          .from(auditLog)
          .where(lt(auditLog.createdAt, cursor))
          .orderBy(desc(auditLog.createdAt))
          .limit(limit + 1)
      : db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit + 1)
    ).all();

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const lastEntry = page.at(-1);
    const nextCursor =
      hasMore && lastEntry?.createdAt instanceof Date
        ? String(lastEntry.createdAt.getTime())
        : null;

    return c.json({ entries: page, nextCursor });
  });

  routes.get('/sequences', (c) => {
    const { db } = getCtx(c);
    const values = db.select().from(sequences).orderBy(desc(sequences.updatedAt)).all();
    return c.json({ sequences: values });
  });

  routes.get('/record-audits/:table/:id', (c) => {
    const { db } = getCtx(c);
    const tableName = c.req.param('table');
    const recordId = c.req.param('id');

    const entries = db
      .select()
      .from(recordAudits)
      .where(and(eq(recordAudits.tableName, tableName), eq(recordAudits.recordId, recordId)))
      .orderBy(desc(recordAudits.createdAt))
      .all();

    return c.json({ entries });
  });

  return routes;
}
