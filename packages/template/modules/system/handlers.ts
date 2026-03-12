import { and, desc, eq, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  auditLog,
  getCtx,
  recordAudits,
  sequences,
  unauthorized,
} from '@vobase/core';

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

export const systemRoutes = new Hono({ strict: false })
  .get('/', (c) => {
    const { user } = getCtx(c);
    if (!user) throw unauthorized();

    return c.json({
      version: SYSTEM_VERSION,
      uptime: process.uptime(),
      modules: ['system'],
    });
  })
  .get('/health', (c) => {
    return c.json({ status: 'ok', db: 'ok', uptime: process.uptime() });
  })
  .get('/audit-log', (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const limit = parseLimit(c.req.query('limit'));
    const cursor = parseCursor(c.req.query('cursor'));

    const entries = (
      cursor
        ? db
            .select()
            .from(auditLog)
            .where(lt(auditLog.createdAt, cursor))
            .orderBy(desc(auditLog.createdAt))
            .limit(limit + 1)
        : db
            .select()
            .from(auditLog)
            .orderBy(desc(auditLog.createdAt))
            .limit(limit + 1)
    ).all();

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const lastEntry = page.at(-1);
    const nextCursor =
      hasMore && lastEntry?.createdAt instanceof Date
        ? String(lastEntry.createdAt.getTime())
        : null;

    return c.json({ entries: page, nextCursor });
  })
  .get('/sequences', (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const values = db
      .select()
      .from(sequences)
      .orderBy(desc(sequences.updatedAt))
      .all();
    return c.json({ sequences: values });
  })
  .get('/record-audits/:table/:id', (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const tableName = c.req.param('table');
    const recordId = c.req.param('id');

    const entries = db
      .select()
      .from(recordAudits)
      .where(
        and(
          eq(recordAudits.tableName, tableName),
          eq(recordAudits.recordId, recordId),
        ),
      )
      .orderBy(desc(recordAudits.createdAt))
      .all();

    return c.json({ entries });
  });
