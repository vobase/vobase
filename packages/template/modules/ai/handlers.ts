import { getCtx, notFound, unauthorized, validation } from '@vobase/core';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  aiEvalRuns,
  aiMemCells,
  aiMemEpisodes,
  aiMemEventLogs,
  aiModerationLogs,
  aiWorkflowRuns,
} from './schema';

/** Safely parse a JSON text column, returning fallback on failure. */
function safeJsonParse(
  value: string | null,
  fallback: unknown = null,
): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

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

  const { retrieveMemory } = await import(
    '../../mastra/processors/memory/retriever'
  );
  const result = await retrieveMemory(db, scope, query);
  return c.json(result);
});

// --- Memory: Episodes & Facts ---

const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Parse a composite cursor of format `timestamp_id` for correct keyset pagination. */
function parseCursor(cursor: string): { ts: Date; id: string } | null {
  const sep = cursor.indexOf('_');
  if (sep === -1) return null;
  const ts = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(ts.getTime()) || !id) return null;
  return { ts, id };
}

/** Build a composite cursor string from a row's createdAt + id. */
function buildCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}_${row.id}`;
}

/** GET /memory/episodes?scope=contact:ID|user:ID&cursor=&limit= */
aiRoutes.get('/memory/episodes', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const rawScope = c.req.query('scope');
  if (!rawScope)
    throw validation({ scope: 'Required. Format: contact:ID or user:ID' });

  const parsed = scopeSchema.safeParse(rawScope);
  if (!parsed.success) throw validation({ scope: parsed.error.message });

  const { cursor, limit } = paginationSchema.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });

  const scope = parseScope(rawScope);
  const isContact = 'contactId' in scope;
  const scopeId = isContact ? scope.contactId : scope.userId;
  const episodeWhere = isContact
    ? eq(aiMemEpisodes.contactId, scopeId!)
    : eq(aiMemEpisodes.userId, scopeId!);

  const cursorFilter = cursor ? parseCursor(cursor) : null;
  const conditions = cursorFilter
    ? and(
        episodeWhere,
        sql`(${aiMemEpisodes.createdAt} < ${cursorFilter.ts} OR (${aiMemEpisodes.createdAt} = ${cursorFilter.ts} AND ${aiMemEpisodes.id} < ${cursorFilter.id}))`,
      )
    : episodeWhere;

  const episodes = await db
    .select({
      id: aiMemEpisodes.id,
      cellId: aiMemEpisodes.cellId,
      title: aiMemEpisodes.title,
      content: aiMemEpisodes.content,
      createdAt: aiMemEpisodes.createdAt,
      threadId: aiMemCells.threadId,
      factCount: sql<number>`cast(count(${aiMemEventLogs.id}) as int)`,
    })
    .from(aiMemEpisodes)
    .leftJoin(aiMemCells, eq(aiMemEpisodes.cellId, aiMemCells.id))
    .leftJoin(aiMemEventLogs, eq(aiMemEpisodes.cellId, aiMemEventLogs.cellId))
    .where(conditions)
    .groupBy(aiMemEpisodes.id, aiMemCells.threadId)
    .orderBy(desc(aiMemEpisodes.createdAt), desc(aiMemEpisodes.id))
    .limit(limit + 1);

  const hasMore = episodes.length > limit;
  const page = hasMore ? episodes.slice(0, limit) : episodes;
  const lastItem = page[page.length - 1];
  const nextCursor = hasMore && lastItem ? buildCursor(lastItem) : null;

  return c.json({ episodes: page, nextCursor });
});

/** GET /memory/facts?scope=contact:ID|user:ID&episodeId=&cursor=&limit= */
aiRoutes.get('/memory/facts', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const rawScope = c.req.query('scope');
  if (!rawScope)
    throw validation({ scope: 'Required. Format: contact:ID or user:ID' });

  const parsed = scopeSchema.safeParse(rawScope);
  if (!parsed.success) throw validation({ scope: parsed.error.message });

  const { cursor, limit } = paginationSchema.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });

  const episodeId = c.req.query('episodeId');

  const scope = parseScope(rawScope);
  const isContact = 'contactId' in scope;
  const scopeId = isContact ? scope.contactId : scope.userId;
  const factWhere = isContact
    ? eq(aiMemEventLogs.contactId, scopeId!)
    : eq(aiMemEventLogs.userId, scopeId!);

  const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [
    factWhere,
  ];
  const cursorFilter = cursor ? parseCursor(cursor) : null;
  if (cursorFilter) {
    conditions.push(
      sql`(${aiMemEventLogs.createdAt} < ${cursorFilter.ts} OR (${aiMemEventLogs.createdAt} = ${cursorFilter.ts} AND ${aiMemEventLogs.id} < ${cursorFilter.id}))`,
    );
  }

  // Filter by episode: episode and facts share the same cellId
  if (episodeId) {
    const episode = (
      await db
        .select({ cellId: aiMemEpisodes.cellId })
        .from(aiMemEpisodes)
        .where(eq(aiMemEpisodes.id, episodeId))
    )[0];
    if (!episode) throw notFound('Episode not found');
    conditions.push(eq(aiMemEventLogs.cellId, episode.cellId));
  }

  const facts = await db
    .select({
      id: aiMemEventLogs.id,
      cellId: aiMemEventLogs.cellId,
      fact: aiMemEventLogs.fact,
      subject: aiMemEventLogs.subject,
      occurredAt: aiMemEventLogs.occurredAt,
      createdAt: aiMemEventLogs.createdAt,
    })
    .from(aiMemEventLogs)
    .where(and(...conditions))
    .orderBy(desc(aiMemEventLogs.createdAt), desc(aiMemEventLogs.id))
    .limit(limit + 1);

  const hasMore = facts.length > limit;
  const page = hasMore ? facts.slice(0, limit) : facts;
  const lastFact = page[page.length - 1];
  const nextCursor = hasMore && lastFact ? buildCursor(lastFact) : null;

  return c.json({ facts: page, nextCursor });
});

/** DELETE /memory/facts/:id */
aiRoutes.delete('/memory/facts/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const factId = c.req.param('id');

  const fact = (
    await db
      .select({
        id: aiMemEventLogs.id,
        contactId: aiMemEventLogs.contactId,
        userId: aiMemEventLogs.userId,
      })
      .from(aiMemEventLogs)
      .where(eq(aiMemEventLogs.id, factId))
  )[0];
  if (!fact) throw notFound('Fact not found');

  // Verify scope ownership: user-scoped facts must match, contact-scoped facts require user relationship
  if (fact.userId && fact.userId !== user.id) throw unauthorized();
  if (fact.contactId && !fact.userId) {
    // Contact-scoped: verify user has a conversation with this contact
    const { msgConversations } = await import('../messaging/schema');
    const [conversation] = await db
      .select({ id: msgConversations.id })
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.userId, user.id),
          eq(msgConversations.contactId, fact.contactId),
        ),
      )
      .limit(1);
    if (!conversation) throw unauthorized();
  }

  const deleted = await db
    .delete(aiMemEventLogs)
    .where(eq(aiMemEventLogs.id, factId))
    .returning({ id: aiMemEventLogs.id });

  if (deleted.length === 0) throw notFound('Fact not found');

  return c.json({ success: true });
});

/** DELETE /memory/episodes/:id */
aiRoutes.delete('/memory/episodes/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const episodeId = c.req.param('id');

  const episode = (
    await db
      .select({
        id: aiMemEpisodes.id,
        cellId: aiMemEpisodes.cellId,
        contactId: aiMemEpisodes.contactId,
        userId: aiMemEpisodes.userId,
      })
      .from(aiMemEpisodes)
      .where(eq(aiMemEpisodes.id, episodeId))
  )[0];
  if (!episode) throw notFound('Episode not found');

  // Verify scope ownership: user-scoped episodes must match, contact-scoped require user relationship
  if (episode.userId && episode.userId !== user.id) throw unauthorized();
  if (episode.contactId && !episode.userId) {
    const { msgConversations } = await import('../messaging/schema');
    const [conversation] = await db
      .select({ id: msgConversations.id })
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.userId, user.id),
          eq(msgConversations.contactId, episode.contactId),
        ),
      )
      .limit(1);
    if (!conversation) throw unauthorized();
  }

  // Delete associated facts sharing the same cellId, then the episode
  await db
    .delete(aiMemEventLogs)
    .where(eq(aiMemEventLogs.cellId, episode.cellId));

  await db.delete(aiMemEpisodes).where(eq(aiMemEpisodes.id, episodeId));

  return c.json({ success: true });
});

// --- Evals ---

const evalRunSchema = z.object({
  agentId: z.string().min(1),
  data: z.array(
    z.object({
      input: z.string(),
      output: z.string(),
      context: z.array(z.string()),
    }),
  ),
});

/** POST /evals/run — create an eval run and queue the scoring job */
aiRoutes.post('/evals/run', async (c) => {
  const { db, user, scheduler } = getCtx(c);
  if (!user) throw unauthorized();

  const body = evalRunSchema.parse(await c.req.json());

  const [run] = await db
    .insert(aiEvalRuns)
    .values({
      agentId: body.agentId,
      status: 'pending',
      itemCount: body.data.length,
      // Store input data temporarily in results column; job replaces with scored results
      results: JSON.stringify(body.data),
    })
    .returning();

  await scheduler.add('ai:eval-run', { runId: run.id });

  return c.json({ runId: run.id }, 201);
});

/** GET /evals/:runId — fetch eval run status + results */
aiRoutes.get('/evals/:runId', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const run = (
    await db
      .select()
      .from(aiEvalRuns)
      .where(eq(aiEvalRuns.id, c.req.param('runId')))
  )[0];
  if (!run) throw notFound('Eval run not found');

  return c.json({
    id: run.id,
    agentId: run.agentId,
    status: run.status,
    itemCount: run.itemCount,
    results: run.status === 'complete' ? safeJsonParse(run.results) : null,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  });
});

// --- Guardrails ---

/** GET /guardrails/config — returns active guardrail rules and config */
aiRoutes.get('/guardrails/config', async (c) => {
  const { user } = getCtx(c);
  if (!user) throw unauthorized();

  // Config is code-defined — expose defaults for the UI
  return c.json({
    rules: [
      {
        id: 'content-moderation',
        name: 'Content Moderation',
        type: 'input-processor',
        config: {
          blocklist: [] as string[],
          maxLength: 10_000,
        },
        appliedTo: 'all-agents',
      },
    ],
  });
});

/** GET /guardrails/logs?cursor=&limit= — paginated moderation event log */
aiRoutes.get('/guardrails/logs', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const { cursor, limit } = paginationSchema.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });

  const cursorFilter = cursor ? parseCursor(cursor) : null;
  const conditions = cursorFilter
    ? sql`(${aiModerationLogs.createdAt} < ${cursorFilter.ts} OR (${aiModerationLogs.createdAt} = ${cursorFilter.ts} AND ${aiModerationLogs.id} < ${cursorFilter.id}))`
    : undefined;

  const logs = await db
    .select({
      id: aiModerationLogs.id,
      agentId: aiModerationLogs.agentId,
      channel: aiModerationLogs.channel,
      userId: aiModerationLogs.userId,
      contactId: aiModerationLogs.contactId,
      conversationId: aiModerationLogs.threadId,
      reason: aiModerationLogs.reason,
      blockedContent: aiModerationLogs.blockedContent,
      matchedTerm: aiModerationLogs.matchedTerm,
      createdAt: aiModerationLogs.createdAt,
    })
    .from(aiModerationLogs)
    .where(conditions)
    .orderBy(desc(aiModerationLogs.createdAt), desc(aiModerationLogs.id))
    .limit(limit + 1);

  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;
  const lastItem = page[page.length - 1];
  const nextCursor = hasMore && lastItem ? buildCursor(lastItem) : null;

  return c.json({ logs: page, nextCursor });
});

// --- Workflow Registry ---

import { escalationMeta } from '../../mastra/workflows/escalation';
import { followUpMeta } from '../../mastra/workflows/follow-up';

const workflowRegistry = [escalationMeta, followUpMeta];

/** GET /workflows/registry — returns registered workflow definitions with run counts */
aiRoutes.get('/workflows/registry', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const runCounts = await db
    .select({
      workflowId: aiWorkflowRuns.workflowId,
      count: count(),
    })
    .from(aiWorkflowRuns)
    .groupBy(aiWorkflowRuns.workflowId);

  const countMap = new Map(runCounts.map((r) => [r.workflowId, r.count]));

  const workflows = workflowRegistry.map((meta) => ({
    ...meta,
    stepCount: meta.steps.length,
    runCount: countMap.get(meta.id) ?? 0,
  }));

  return c.json({ workflows });
});

const workflowRunsSchema = paginationSchema.extend({
  status: z.enum(['running', 'suspended', 'completed', 'failed']).optional(),
});

/** GET /workflows/:workflowId/runs?cursor=&limit=&status= — paginated run history */
aiRoutes.get('/workflows/:workflowId/runs', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const workflowId = c.req.param('workflowId');
  const { cursor, limit, status } = workflowRunsSchema.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
    status: c.req.query('status'),
  });

  const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [
    eq(aiWorkflowRuns.workflowId, workflowId),
    eq(aiWorkflowRuns.userId, user.id),
  ];

  if (status) {
    conditions.push(eq(aiWorkflowRuns.status, status));
  }

  const cursorFilter = cursor ? parseCursor(cursor) : null;
  if (cursorFilter) {
    conditions.push(
      sql`(${aiWorkflowRuns.createdAt} < ${cursorFilter.ts} OR (${aiWorkflowRuns.createdAt} = ${cursorFilter.ts} AND ${aiWorkflowRuns.id} < ${cursorFilter.id}))`,
    );
  }

  const runs = await db
    .select({
      id: aiWorkflowRuns.id,
      workflowId: aiWorkflowRuns.workflowId,
      status: aiWorkflowRuns.status,
      inputData: aiWorkflowRuns.inputData,
      suspendPayload: aiWorkflowRuns.suspendPayload,
      outputData: aiWorkflowRuns.outputData,
      createdAt: aiWorkflowRuns.createdAt,
      updatedAt: aiWorkflowRuns.updatedAt,
    })
    .from(aiWorkflowRuns)
    .where(and(...conditions))
    .orderBy(desc(aiWorkflowRuns.createdAt), desc(aiWorkflowRuns.id))
    .limit(limit + 1);

  const hasMore = runs.length > limit;
  const page = hasMore ? runs.slice(0, limit) : runs;
  const lastItem = page[page.length - 1];
  const nextCursor = hasMore && lastItem ? buildCursor(lastItem) : null;

  return c.json({
    runs: page.map((r) => ({
      ...r,
      inputData: safeJsonParse(r.inputData),
      suspendPayload: safeJsonParse(r.suspendPayload),
      outputData: safeJsonParse(r.outputData),
    })),
    nextCursor,
  });
});

// --- MCP ---

/** ALL /mcp — MCP server for AI tools (separate from core's /mcp) */
aiRoutes.all('/mcp', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();
  const { createAiMcpHandler } = await import('../../mastra/mcp/server');
  const handler = createAiMcpHandler(db);
  return handler(c.req.raw);
});

// --- Workflows ---

const startEscalationSchema = z.object({
  conversationId: z.string().min(1),
  reason: z.string().min(1),
});

const resumeEscalationSchema = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
});

const startFollowUpSchema = z.object({
  conversationId: z.string().min(1),
  delayMinutes: z.number().min(1),
});

/** POST /workflows/escalation/start — start an escalation workflow run */
aiRoutes.post('/workflows/escalation/start', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = startEscalationSchema.parse(await c.req.json());

  // Step 1: analyze (inline — lightweight, no LLM call)
  const summary = `Escalation requested for conversation ${body.conversationId}: ${body.reason}`;

  // Create workflow run in suspended state (waiting for human approval)
  const [run] = await db
    .insert(aiWorkflowRuns)
    .values({
      workflowId: 'ai:escalation',
      userId: user.id,
      status: 'suspended',
      inputData: JSON.stringify(body),
      suspendPayload: JSON.stringify({
        reason: body.reason,
        conversationId: body.conversationId,
        summary,
      }),
    })
    .returning();

  return c.json(
    {
      runId: run.id,
      status: 'suspended',
      suspendPayload: {
        reason: body.reason,
        conversationId: body.conversationId,
        summary,
      },
    },
    201,
  );
});

/** POST /workflows/escalation/:runId/resume — resume with human decision */
aiRoutes.post('/workflows/escalation/:runId/resume', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const runId = c.req.param('runId');
  const body = resumeEscalationSchema.parse(await c.req.json());

  const run = (
    await db
      .select()
      .from(aiWorkflowRuns)
      .where(
        and(eq(aiWorkflowRuns.id, runId), eq(aiWorkflowRuns.userId, user.id)),
      )
  )[0];
  if (!run) throw notFound('Workflow run not found');
  if (run.status !== 'suspended') {
    throw validation({ status: `Run is ${run.status}, not suspended` });
  }

  // Step 3: execute escalation decision
  const output = body.approved
    ? {
        escalated: true,
        note: body.note ?? 'Escalation approved by human reviewer.',
      }
    : {
        escalated: false,
        note: body.note ?? 'Escalation rejected by human reviewer.',
      };

  const [updated] = await db
    .update(aiWorkflowRuns)
    .set({
      status: 'completed',
      outputData: JSON.stringify(output),
      suspendPayload: null,
    })
    .where(eq(aiWorkflowRuns.id, runId))
    .returning();

  return c.json({ runId: updated.id, status: 'completed', output });
});

/** GET /workflows/escalation/:runId — get escalation run status */
aiRoutes.get('/workflows/escalation/:runId', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const run = (
    await db
      .select()
      .from(aiWorkflowRuns)
      .where(
        and(
          eq(aiWorkflowRuns.id, c.req.param('runId')),
          eq(aiWorkflowRuns.userId, user.id),
        ),
      )
  )[0];
  if (!run) throw notFound('Workflow run not found');

  return c.json({
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    inputData: safeJsonParse(run.inputData),
    suspendPayload: safeJsonParse(run.suspendPayload),
    outputData: safeJsonParse(run.outputData),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
});

/** POST /workflows/follow-up/start — start a follow-up workflow run */
aiRoutes.post('/workflows/follow-up/start', async (c) => {
  const { db, user, scheduler } = getCtx(c);
  if (!user) throw unauthorized();

  const body = startFollowUpSchema.parse(await c.req.json());

  // Create workflow run in suspended state (waiting for delayed job to resume)
  const [run] = await db
    .insert(aiWorkflowRuns)
    .values({
      workflowId: 'ai:follow-up',
      userId: user.id,
      status: 'suspended',
      inputData: JSON.stringify(body),
      suspendPayload: JSON.stringify({
        conversationId: body.conversationId,
        delayMinutes: body.delayMinutes,
        scheduledAt: new Date(
          Date.now() + body.delayMinutes * 60_000,
        ).toISOString(),
      }),
    })
    .returning();

  // Queue delayed job to resume the workflow
  await scheduler.add(
    'ai:follow-up-resume',
    { runId: run.id },
    { startAfter: body.delayMinutes * 60 },
  );

  return c.json(
    {
      runId: run.id,
      status: 'suspended',
      resumesAt: new Date(
        Date.now() + body.delayMinutes * 60_000,
      ).toISOString(),
    },
    201,
  );
});

/** GET /workflows/follow-up/:runId — get follow-up run status */
aiRoutes.get('/workflows/follow-up/:runId', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const run = (
    await db
      .select()
      .from(aiWorkflowRuns)
      .where(
        and(
          eq(aiWorkflowRuns.id, c.req.param('runId')),
          eq(aiWorkflowRuns.userId, user.id),
        ),
      )
  )[0];
  if (!run) throw notFound('Workflow run not found');

  return c.json({
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    inputData: safeJsonParse(run.inputData),
    suspendPayload: safeJsonParse(run.suspendPayload),
    outputData: safeJsonParse(run.outputData),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
});
