import { authUser, getCtx, unauthorized } from '@vobase/core';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';

/**
 * GET /team-members — list every internal authUser for the assignee dropdown.
 * Returns `{ id, name }[]` where `id` is the authUser.id (matching
 * `conversations.assignee` for human targets). No org-scoping — this template
 * treats all authUsers as assignable staff.
 */
export const teamMembersHandlers = new Hono().get(
  '/team-members',
  async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select({ id: authUser.id, name: authUser.name, email: authUser.email })
      .from(authUser)
      .orderBy(asc(authUser.name));

    return c.json(
      rows.map((r) => ({ id: r.id, name: r.name || r.email || 'Unknown' })),
    );
  },
);
