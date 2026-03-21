import { getCtx, notFound, unauthorized, validation } from '@vobase/core';
import { and, count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  aiEvalRuns,
  aiMemCells,
  aiMemEpisodes,
  aiMemEventLogs,
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

  const { retrieveMemory } = await import('./lib/memory/retriever');
  const result = await retrieveMemory(db, scope, query);
  return c.json(result);
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

// --- MCP ---

/** ALL /mcp — MCP server for AI tools (separate from core's /mcp) */
aiRoutes.all('/mcp', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();
  const { createAiMcpHandler } = await import('./lib/mcp/server');
  const handler = createAiMcpHandler(db);
  return handler(c.req.raw);
});

// --- Workflows ---

const startEscalationSchema = z.object({
  threadId: z.string().min(1),
  reason: z.string().min(1),
});

const resumeEscalationSchema = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
});

const startFollowUpSchema = z.object({
  threadId: z.string().min(1),
  delayMinutes: z.number().min(1),
});

/** POST /workflows/escalation/start — start an escalation workflow run */
aiRoutes.post('/workflows/escalation/start', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = startEscalationSchema.parse(await c.req.json());

  // Step 1: analyze (inline — lightweight, no LLM call)
  const summary = `Escalation requested for thread ${body.threadId}: ${body.reason}`;

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
        threadId: body.threadId,
        summary,
      }),
    })
    .returning();

  return c.json(
    {
      runId: run.id,
      status: 'suspended',
      suspendPayload: { reason: body.reason, threadId: body.threadId, summary },
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
      updatedAt: new Date(),
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
        threadId: body.threadId,
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
