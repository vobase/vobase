import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { createTestDb } from '../../lib/test-helpers';
import { aiRoutes } from './handlers';
import {
  aiMemCells,
  aiMemEpisodes,
  aiMemEventLogs,
  aiModerationLogs,
  aiWorkflowRuns,
} from './schema';

const BASE = 'http://localhost/api/ai';

function createApp(
  db: VobaseDb,
  user = { id: 'user-1', email: 'test@test.com', name: 'Test', role: 'user' },
) {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('user', user);
    c.set('scheduler', {} as never);
    c.set('storage', {} as never);
    c.set('channels', {} as never);
    c.set('http', {} as never);
    await next();
  });
  app.route('/api/ai', aiRoutes);
  return app;
}

async function seedMemoryData(db: VobaseDb) {
  // Create a cell
  await db.insert(aiMemCells).values({
    id: 'cell-1',
    threadId: 'thr-1',
    userId: 'user-1',
    startMessageId: 'msg-1',
    endMessageId: 'msg-5',
    messageCount: 5,
    tokenCount: 500,
    status: 'ready',
  });

  // Create an episode for the cell
  await db.insert(aiMemEpisodes).values({
    id: 'ep-1',
    cellId: 'cell-1',
    userId: 'user-1',
    title: 'Budget discussion',
    content: 'User discussed their monthly budget preferences.',
  });

  // Create facts for the cell
  await db.insert(aiMemEventLogs).values({
    id: 'fact-1',
    cellId: 'cell-1',
    userId: 'user-1',
    fact: 'User prefers monthly billing',
    subject: 'billing',
  });
  await db.insert(aiMemEventLogs).values({
    id: 'fact-2',
    cellId: 'cell-1',
    userId: 'user-1',
    fact: 'Budget is $500 per month',
    subject: 'budget',
  });

  // Create data for another user (should not be visible)
  await db.insert(aiMemCells).values({
    id: 'cell-other',
    threadId: 'thr-other',
    userId: 'user-2',
    startMessageId: 'msg-10',
    endMessageId: 'msg-15',
    messageCount: 5,
    tokenCount: 300,
    status: 'ready',
  });
  await db.insert(aiMemEpisodes).values({
    id: 'ep-other',
    cellId: 'cell-other',
    userId: 'user-2',
    title: 'Other user episode',
    content: 'Should not be visible to user-1.',
  });
  await db.insert(aiMemEventLogs).values({
    id: 'fact-other',
    cellId: 'cell-other',
    userId: 'user-2',
    fact: 'Other user fact',
    subject: 'other',
  });
}

describe('AI Memory Endpoints', () => {
  let pglite: PGlite;
  let db: VobaseDb;
  let app: Hono;

  beforeEach(async () => {
    const testDb = await createTestDb({ withMemory: true });
    pglite = testDb.pglite;
    db = testDb.db;
    app = createApp(db);
    await seedMemoryData(db);
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe('GET /memory/episodes', () => {
    it('returns episodes for user scope', async () => {
      const res = await app.request(
        `${BASE}/memory/episodes?scope=user:user-1`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.episodes).toHaveLength(1);
      expect(body.episodes[0].title).toBe('Budget discussion');
      expect(body.episodes[0].threadId).toBe('thr-1');
      expect(body.episodes[0].factCount).toBe(2);
      expect(body.nextCursor).toBeNull();
    });

    it('does not return other users episodes', async () => {
      const res = await app.request(
        `${BASE}/memory/episodes?scope=user:user-1`,
      );
      const body = await res.json();
      expect(body.episodes).toHaveLength(1);
      expect(body.episodes[0].id).toBe('ep-1');
    });

    it('returns empty for unknown scope', async () => {
      const res = await app.request(
        `${BASE}/memory/episodes?scope=user:nobody`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.episodes).toHaveLength(0);
      expect(body.nextCursor).toBeNull();
    });

    it('returns 400 without scope param', async () => {
      const res = await app.request(`${BASE}/memory/episodes`);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid scope format', async () => {
      const res = await app.request(`${BASE}/memory/episodes?scope=invalid`);
      expect(res.status).toBe(400);
    });

    it('supports pagination via limit', async () => {
      const res = await app.request(
        `${BASE}/memory/episodes?scope=user:user-1&limit=1`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.episodes).toHaveLength(1);
    });
  });

  describe('GET /memory/facts', () => {
    it('returns facts for user scope', async () => {
      const res = await app.request(`${BASE}/memory/facts?scope=user:user-1`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.facts).toHaveLength(2);
      expect(body.nextCursor).toBeNull();
    });

    it('filters facts by episodeId', async () => {
      const res = await app.request(
        `${BASE}/memory/facts?scope=user:user-1&episodeId=ep-1`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.facts).toHaveLength(2);
      // All facts share cell-1 with ep-1
      for (const fact of body.facts) {
        expect(fact.cellId).toBe('cell-1');
      }
    });

    it('returns 404 for unknown episodeId', async () => {
      const res = await app.request(
        `${BASE}/memory/facts?scope=user:user-1&episodeId=nonexistent`,
      );
      expect(res.status).toBe(404);
    });

    it('does not return other users facts', async () => {
      const res = await app.request(`${BASE}/memory/facts?scope=user:user-1`);
      const body = await res.json();
      expect(body.facts).toHaveLength(2);
      for (const fact of body.facts) {
        expect(fact.id).not.toBe('fact-other');
      }
    });

    it('returns 400 without scope', async () => {
      const res = await app.request(`${BASE}/memory/facts`);
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /memory/facts/:id', () => {
    it('deletes a fact owned by user', async () => {
      const res = await app.request(`${BASE}/memory/facts/fact-1`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify fact is gone
      const remaining = await db
        .select()
        .from(aiMemEventLogs)
        .where(eq(aiMemEventLogs.id, 'fact-1'));
      expect(remaining).toHaveLength(0);
    });

    it('returns 404 for nonexistent fact', async () => {
      const res = await app.request(`${BASE}/memory/facts/nonexistent`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });

    it('returns 401 when deleting other users fact', async () => {
      const res = await app.request(`${BASE}/memory/facts/fact-other`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);

      // Verify fact still exists
      const remaining = await db
        .select()
        .from(aiMemEventLogs)
        .where(eq(aiMemEventLogs.id, 'fact-other'));
      expect(remaining).toHaveLength(1);
    });
  });

  describe('DELETE /memory/episodes/:id', () => {
    it('deletes episode and its associated facts', async () => {
      const res = await app.request(`${BASE}/memory/episodes/ep-1`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify episode is gone
      const episodes = await db
        .select()
        .from(aiMemEpisodes)
        .where(eq(aiMemEpisodes.id, 'ep-1'));
      expect(episodes).toHaveLength(0);

      // Verify facts sharing the same cellId are also deleted
      const facts = await db
        .select()
        .from(aiMemEventLogs)
        .where(eq(aiMemEventLogs.cellId, 'cell-1'));
      expect(facts).toHaveLength(0);
    });

    it('returns 404 for nonexistent episode', async () => {
      const res = await app.request(`${BASE}/memory/episodes/nonexistent`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });

    it('returns 401 when deleting other users episode', async () => {
      const res = await app.request(`${BASE}/memory/episodes/ep-other`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);

      // Verify episode still exists
      const episodes = await db
        .select()
        .from(aiMemEpisodes)
        .where(eq(aiMemEpisodes.id, 'ep-other'));
      expect(episodes).toHaveLength(1);
    });

    it('does not affect other users facts when cascading', async () => {
      await app.request(`${BASE}/memory/episodes/ep-1`, {
        method: 'DELETE',
      });

      // Other user's facts should be untouched
      const otherFacts = await db
        .select()
        .from(aiMemEventLogs)
        .where(eq(aiMemEventLogs.id, 'fact-other'));
      expect(otherFacts).toHaveLength(1);
    });
  });
});

// --- Guardrails + Workflow Tests ---

describe('AI Guardrails & Workflow Endpoints', () => {
  let pglite: PGlite;
  let db: VobaseDb;
  let app: Hono;

  beforeEach(async () => {
    const testDb = await createTestDb({
      withMemory: true,
      withWorkflows: true,
    });
    pglite = testDb.pglite;
    db = testDb.db;
    app = createApp(db);
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe('GET /guardrails/config', () => {
    it('returns guardrail rules with config', async () => {
      const res = await app.request(`${BASE}/guardrails/config`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0].id).toBe('content-moderation');
      expect(body.rules[0].type).toBe('input-processor');
      expect(body.rules[0].config.maxLength).toBe(10_000);
      expect(body.rules[0].appliedTo).toBe('all-agents');
    });

    it('returns 401 without auth', async () => {
      const noAuthApp = createApp(db, null as never);
      const res = await noAuthApp.request(`${BASE}/guardrails/config`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /guardrails/logs', () => {
    it('returns empty when no logs exist', async () => {
      const res = await app.request(`${BASE}/guardrails/logs`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logs).toHaveLength(0);
      expect(body.nextCursor).toBeNull();
    });

    it('returns logs after seeding', async () => {
      await db.insert(aiModerationLogs).values({
        id: 'log-1',
        agentId: 'agent-1',
        channel: 'web',
        userId: 'user-1',
        reason: 'blocklist',
        blockedContent: 'bad content',
        matchedTerm: 'bad',
      });
      await db.insert(aiModerationLogs).values({
        id: 'log-2',
        agentId: 'agent-1',
        channel: 'whatsapp',
        reason: 'max_length',
        blockedContent: 'very long...',
      });

      const res = await app.request(`${BASE}/guardrails/logs`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logs).toHaveLength(2);
      expect(body.logs[0].reason).toBeDefined();
    });

    it('supports cursor pagination', async () => {
      // Seed 3 logs with different timestamps
      for (let i = 1; i <= 3; i++) {
        await db.insert(aiModerationLogs).values({
          id: `log-${i}`,
          agentId: 'agent-1',
          channel: 'web',
          reason: 'blocklist',
          matchedTerm: 'test',
        });
      }

      const res1 = await app.request(`${BASE}/guardrails/logs?limit=2`);
      const body1 = await res1.json();
      expect(body1.logs).toHaveLength(2);
      expect(body1.nextCursor).toBeTruthy();

      const res2 = await app.request(
        `${BASE}/guardrails/logs?cursor=${body1.nextCursor}&limit=2`,
      );
      const body2 = await res2.json();
      expect(body2.logs).toHaveLength(1);
      expect(body2.nextCursor).toBeNull();
    });
  });

  describe('GET /workflows/registry', () => {
    it('returns registered workflows with step details', async () => {
      const res = await app.request(`${BASE}/workflows/registry`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows).toHaveLength(2);

      const escalation = body.workflows.find(
        (w: { id: string }) => w.id === 'ai:escalation',
      );
      expect(escalation).toBeDefined();
      expect(escalation.name).toBe('Escalation');
      expect(escalation.stepCount).toBe(3);
      expect(escalation.steps).toHaveLength(3);
      expect(escalation.steps[1].type).toBe('suspend');

      const followUp = body.workflows.find(
        (w: { id: string }) => w.id === 'ai:follow-up',
      );
      expect(followUp).toBeDefined();
      expect(followUp.name).toBe('Follow-up');
      expect(followUp.stepCount).toBe(3);
    });

    it('includes run counts', async () => {
      await db.insert(aiWorkflowRuns).values({
        id: 'run-1',
        workflowId: 'ai:escalation',
        userId: 'user-1',
        status: 'completed',
        inputData: '{}',
      });
      await db.insert(aiWorkflowRuns).values({
        id: 'run-2',
        workflowId: 'ai:escalation',
        userId: 'user-1',
        status: 'suspended',
        inputData: '{}',
      });

      const res = await app.request(`${BASE}/workflows/registry`);
      const body = await res.json();
      const escalation = body.workflows.find(
        (w: { id: string }) => w.id === 'ai:escalation',
      );
      expect(escalation.runCount).toBe(2);

      const followUp = body.workflows.find(
        (w: { id: string }) => w.id === 'ai:follow-up',
      );
      expect(followUp.runCount).toBe(0);
    });
  });

  describe('GET /workflows/:workflowId/runs', () => {
    beforeEach(async () => {
      // Seed runs for different workflows and users
      await db.insert(aiWorkflowRuns).values({
        id: 'run-a',
        workflowId: 'ai:escalation',
        userId: 'user-1',
        status: 'completed',
        inputData: JSON.stringify({ threadId: 't1', reason: 'test' }),
        outputData: JSON.stringify({ escalated: true }),
      });
      await db.insert(aiWorkflowRuns).values({
        id: 'run-b',
        workflowId: 'ai:escalation',
        userId: 'user-1',
        status: 'suspended',
        inputData: JSON.stringify({ threadId: 't2', reason: 'test' }),
        suspendPayload: JSON.stringify({ reason: 'waiting' }),
      });
      await db.insert(aiWorkflowRuns).values({
        id: 'run-c',
        workflowId: 'ai:follow-up',
        userId: 'user-1',
        status: 'running',
        inputData: JSON.stringify({ threadId: 't3', delayMinutes: 30 }),
      });
      // Other user's run — should not be visible
      await db.insert(aiWorkflowRuns).values({
        id: 'run-other',
        workflowId: 'ai:escalation',
        userId: 'user-2',
        status: 'completed',
        inputData: '{}',
      });
    });

    it('returns runs filtered by workflowId', async () => {
      const res = await app.request(`${BASE}/workflows/ai:escalation/runs`);
      expect(res.status).toBe(200);
      const body = await res.json();
      // Only user-1's escalation runs (run-a, run-b), not run-other
      expect(body.runs).toHaveLength(2);
      for (const run of body.runs) {
        expect(run.workflowId).toBe('ai:escalation');
      }
    });

    it('only returns current users runs', async () => {
      const res = await app.request(`${BASE}/workflows/ai:escalation/runs`);
      const body = await res.json();
      for (const run of body.runs) {
        expect(run.id).not.toBe('run-other');
      }
    });

    it('filters by status', async () => {
      const res = await app.request(
        `${BASE}/workflows/ai:escalation/runs?status=suspended`,
      );
      const body = await res.json();
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0].id).toBe('run-b');
      expect(body.runs[0].status).toBe('suspended');
    });

    it('parses JSON data fields', async () => {
      const res = await app.request(`${BASE}/workflows/ai:escalation/runs`);
      const body = await res.json();
      const completedRun = body.runs.find(
        (r: { id: string }) => r.id === 'run-a',
      );
      expect(completedRun.inputData).toEqual({
        threadId: 't1',
        reason: 'test',
      });
      expect(completedRun.outputData).toEqual({ escalated: true });
    });

    it('supports cursor pagination', async () => {
      const res1 = await app.request(
        `${BASE}/workflows/ai:escalation/runs?limit=1`,
      );
      const body1 = await res1.json();
      expect(body1.runs).toHaveLength(1);
      expect(body1.nextCursor).toBeTruthy();

      const res2 = await app.request(
        `${BASE}/workflows/ai:escalation/runs?cursor=${body1.nextCursor}&limit=1`,
      );
      const body2 = await res2.json();
      expect(body2.runs).toHaveLength(1);
      expect(body2.nextCursor).toBeNull();
    });

    it('returns empty for unknown workflowId', async () => {
      const res = await app.request(`${BASE}/workflows/nonexistent/runs`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.runs).toHaveLength(0);
    });

    it('requires auth', async () => {
      const noAuthApp = createApp(db, null as never);
      const res = await noAuthApp.request(
        `${BASE}/workflows/ai:escalation/runs`,
      );
      expect(res.status).toBe(401);
    });
  });
});
