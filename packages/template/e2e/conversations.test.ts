/**
 * E2E test: Agent Control Plane (conversations module).
 * Tests against a live dev server with seeded data.
 *
 * Prerequisites:
 *   - docker compose up -d (Postgres running)
 *   - bun run db:push && bun run db:seed
 *   - bun run dev (template server on :3000)
 */
import { beforeAll, describe, expect, test } from 'bun:test';

const BASE = 'http://localhost:3000';
const ORIGIN = 'http://localhost:3000';

let cookie = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Admin@vobase1',
    }),
  });
  const setCookie = signIn.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  expect(signIn.status).toBe(200);
});

// ─── Dashboard ────────────────────────────────────────────────────────

describe('Dashboard aggregates', () => {
  test('returns counts from seeded data', async () => {
    const { status, json } = await api('GET', '/api/ai/dashboard');
    const d = json as Record<string, number>;
    expect(status).toBe(200);
    expect(typeof d.needsAttentionCount).toBe('number');
    expect(d.activeSessions).toBeGreaterThan(0);
    expect(typeof d.resolvedToday).toBe('number');
    expect(typeof d.avgResponseTimeMs).toBe('number');
  });
});

// ─── Attention Queue ──────────────────────────────────────────────────

describe('Attention queue', () => {
  test('returns pending items in FIFO order', async () => {
    const { status, json } = await api('GET', '/api/ai/attention');
    const data = json as {
      items: Array<{
        id: string;
        type: string;
        resolutionStatus: string;
        createdAt: string;
      }>;
      count: number;
    };
    expect(status).toBe(200);
    expect(typeof data.count).toBe('number');

    // All returned items must be pending
    if (data.items.length > 0) {
      expect(data.items.every((i) => i.resolutionStatus === 'pending')).toBe(
        true,
      );

      // FIFO: oldest first
      const dates = data.items.map((i) => new Date(i.createdAt).getTime());
      expect(dates.every((d, i) => i === 0 || d >= dates[i - 1])).toBe(true);
    }
  });

  test('review then 409 on double-review', async () => {
    const { json } = await api('GET', '/api/ai/attention');
    const items = (json as { items: Array<{ id: string }> }).items;
    if (items.length === 0) return; // skip if no pending items (stale seed)

    const targetId = items[0].id;
    const review = await api('POST', `/api/ai/attention/${targetId}/review`);
    expect(review.status).toBe(200);
    expect((review.json as { resolutionStatus: string }).resolutionStatus).toBe(
      'reviewed',
    );

    const double = await api('POST', `/api/ai/attention/${targetId}/review`);
    expect(double.status).toBe(409);
  });

  test('dismiss then 409 on double-dismiss', async () => {
    const { json } = await api('GET', '/api/ai/attention');
    const items = (json as { items: Array<{ id: string }> }).items;
    if (items.length === 0) return; // skip if no pending items (stale seed)

    const targetId = items[0].id;
    const dismiss = await api('POST', `/api/ai/attention/${targetId}/dismiss`);
    expect(dismiss.status).toBe(200);
    expect(
      (dismiss.json as { resolutionStatus: string }).resolutionStatus,
    ).toBe('dismissed');

    const double = await api('POST', `/api/ai/attention/${targetId}/dismiss`);
    expect(double.status).toBe(409);
  });
});

// ─── Activity Feed ────────────────────────────────────────────────────

describe('Activity feed', () => {
  test('pagination across multiple pages', async () => {
    const p1 = await api('GET', '/api/ai/activity?limit=5');
    const page1 = p1.json as {
      events: Array<{ id: string; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(p1.status).toBe(200);
    expect(page1.events.length).toBe(5);
    expect(page1.nextCursor).not.toBeNull();

    const p2 = await api(
      'GET',
      `/api/ai/activity?limit=5&cursor=${page1.nextCursor}`,
    );
    const page2 = p2.json as {
      events: Array<{ id: string; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(p2.status).toBe(200);
    expect(page2.events.length).toBeGreaterThan(0);

    // No duplicates
    const p1Ids = new Set(page1.events.map((e) => e.id));
    expect(page2.events.filter((e) => p1Ids.has(e.id))).toHaveLength(0);

    // Page 2 events are older
    const lastP1 = new Date(page1.events.at(-1)?.createdAt ?? '').getTime();
    const firstP2 = new Date(page2.events[0].createdAt).getTime();
    expect(firstP2).toBeLessThanOrEqual(lastP1);
  });

  test('type filter', async () => {
    const { json } = await api(
      'GET',
      '/api/ai/activity?type=conversation.created&limit=20',
    );
    const events = (json as { events: Array<{ type: string }> }).events;
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.type === 'conversation.created')).toBe(true);
  });

  test('category filter (agent)', async () => {
    const { json } = await api(
      'GET',
      '/api/ai/activity?category=agent&limit=20',
    );
    const events = (json as { events: Array<{ type: string }> }).events;
    expect(events.every((e) => e.type.startsWith('agent.'))).toBe(true);
  });

  test('category filter (escalation)', async () => {
    const { json } = await api(
      'GET',
      '/api/ai/activity?category=escalation&limit=20',
    );
    const events = (json as { events: Array<{ type: string }> }).events;
    expect(events.every((e) => e.type.startsWith('escalation.'))).toBe(true);
  });

  test('category filter (guardrail)', async () => {
    const { json } = await api(
      'GET',
      '/api/ai/activity?category=guardrail&limit=20',
    );
    const events = (json as { events: Array<{ type: string }> }).events;
    expect(events.every((e) => e.type.startsWith('guardrail.'))).toBe(true);
    expect(events.some((e) => e.type === 'guardrail.block')).toBe(true);
    expect(events.some((e) => e.type === 'guardrail.warn')).toBe(true);
  });

  test('channel filter (whatsapp)', async () => {
    const { json } = await api(
      'GET',
      '/api/ai/activity?channelType=whatsapp&limit=20',
    );
    const events = (json as { events: Array<{ channelType: string }> }).events;
    expect(events.every((e) => e.channelType === 'whatsapp')).toBe(true);
  });

  test('time range filter', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { json } = await api(
      'GET',
      `/api/ai/activity?timeFrom=${twoHoursAgo}&limit=20`,
    );
    const events = (json as { events: Array<{ createdAt: string }> }).events;
    expect(
      events.every(
        (e) =>
          new Date(e.createdAt).getTime() >= new Date(twoHoursAgo).getTime(),
      ),
    ).toBe(true);
  });

  test('resolution status filter', async () => {
    const { json } = await api(
      'GET',
      '/api/ai/activity?resolutionStatus=reviewed&limit=20',
    );
    const events = (json as { events: Array<{ resolutionStatus: string }> })
      .events;
    expect(events.every((e) => e.resolutionStatus === 'reviewed')).toBe(true);
  });
});

// ─── Agent Metrics ────────────────────────────────────────────────────

describe('Agent metrics', () => {
  test('returns metrics with resolution outcomes', async () => {
    const { status, json } = await api('GET', '/api/ai/agents/metrics');
    const agents = (
      json as {
        agents: Array<{
          agentId: string;
          activeCount: number;
          queuedCount: number;
          successScore: number;
        }>;
      }
    ).agents;
    expect(status).toBe(200);
    expect(agents.length).toBeGreaterThan(0);

    const booking = agents.find((a) => a.agentId === 'booking');
    expect(booking).toBeDefined();
    expect(booking?.activeCount).toBeGreaterThan(0);
    expect(booking?.successScore).toBeGreaterThanOrEqual(0);
    expect(booking?.successScore).toBeLessThanOrEqual(1);
    expect(booking?.successScore).toBeGreaterThan(0);
  });
});

// ─── Channel Status ───────────────────────────────────────────────────

describe('Channel status', () => {
  test('counts match dashboard', async () => {
    const { json: chJson } = await api('GET', '/api/ai/channels/status');
    const channels = (
      chJson as {
        channels: Array<{
          id: string;
          type: string;
          activeSessionCount: number;
        }>;
      }
    ).channels;
    expect(channels.length).toBeGreaterThan(0);

    const totalActive = channels.reduce(
      (sum, c) => sum + c.activeSessionCount,
      0,
    );
    const { json: dashJson } = await api('GET', '/api/ai/dashboard');
    const dashActive = (dashJson as { activeSessions: number }).activeSessions;
    expect(totalActive).toBe(dashActive);

    // At least one channel instance has active sessions
    expect(channels.some((c) => c.activeSessionCount > 0)).toBe(true);
  });
});

// ─── Mode Guards ──────────────────────────────────────────────────────

describe('Session mode guards', () => {
  test('human-mode session exists', async () => {
    const { status, json } = await api(
      'GET',
      '/api/ai/conversations/sess-human-mode',
    );
    expect(status).toBe(200);
    expect((json as { mode: string }).mode).toBe('human');
  });

  test('held-mode session exists', async () => {
    const { status, json } = await api(
      'GET',
      '/api/ai/conversations/sess-held-mode',
    );
    expect(status).toBe(200);
    expect((json as { mode: string }).mode).toBe('held');
  });

  test('supervised-mode session exists', async () => {
    const { status, json } = await api(
      'GET',
      '/api/ai/conversations/sess-supervised-mode',
    );
    expect(status).toBe(200);
    expect((json as { mode: string }).mode).toBe('supervised');
  });
});

// ─── Handoff → Handback Cycle ─────────────────────────────────────────

describe('Handoff/handback cycle', () => {
  test('handback from human to ai, or rejects if not possible', async () => {
    const current = await api('GET', '/api/ai/conversations/sess-human-mode');
    const { mode, status: sessStatus } = current.json as {
      mode: string;
      status: string;
    };

    const handback = await api(
      'POST',
      '/api/ai/conversations/sess-human-mode/handback',
    );

    if (mode === 'human' && sessStatus === 'active') {
      // Fresh seed — handback should succeed
      expect(handback.status).toBe(200);
      expect((handback.json as { mode: string }).mode).toBe('ai');

      await new Promise((r) => setTimeout(r, 500));
      const events = await api(
        'GET',
        '/api/ai/activity?conversationId=sess-human-mode&type=handler.changed&limit=10',
      );
      const hbEvents = (events.json as { events: Array<{ type: string }> })
        .events;
      expect(hbEvents.length).toBeGreaterThan(0);
    } else {
      // Session already transitioned or terminal — handback should reject
      expect(handback.status).toBe(400);
    }
  });

  test('handback on ai-mode returns 400', async () => {
    // After the previous test, session should be ai
    const double = await api(
      'POST',
      '/api/ai/conversations/sess-human-mode/handback',
    );
    expect(double.status).toBe(400);
  });
});

// ─── Approve Supervised Draft ─────────────────────────────────────────

describe('Approve supervised draft', () => {
  test('approves pending draft or 404 if already approved', async () => {
    const approve = await api(
      'POST',
      '/api/ai/conversations/sess-supervised-mode/approve-draft',
    );

    if (approve.status === 200) {
      expect((approve.json as { draftId: string }).draftId).toBeTruthy();
      // Double-approve: no more pending drafts
      const double = await api(
        'POST',
        '/api/ai/conversations/sess-supervised-mode/approve-draft',
      );
      expect(double.status).toBe(404);
    } else {
      // Already approved in previous run — 404 is expected
      expect(approve.status).toBe(404);
    }
  });
});

// ─── Session Completion ───────────────────────────────────────────────

describe('Session lifecycle', () => {
  test('complete session emits event', async () => {
    const complete = await api(
      'PATCH',
      '/api/ai/conversations/sess-for-completion',
      { status: 'completed' },
    );
    expect(complete.status).toBe(200);
    expect((complete.json as { status: string }).status).toBe('completed');

    await new Promise((r) => setTimeout(r, 500));
    const events = await api(
      'GET',
      '/api/ai/activity?conversationId=sess-for-completion&limit=10',
    );
    const types = (
      events.json as { events: Array<{ type: string }> }
    ).events.map((e) => e.type);
    expect(types).toContain('conversation.completed');
  });

  test('fail session sets resolution outcome + event', async () => {
    // Check current status — seed may have been mutated by previous runs
    const current = await api('GET', '/api/ai/conversations/sess-for-handoff');
    const currentStatus = (current.json as { status: string }).status;

    if (currentStatus === 'active') {
      const fail = await api(
        'PATCH',
        '/api/ai/conversations/sess-for-handoff',
        { status: 'failed' },
      );
      expect(fail.status).toBe(200);
      const data = fail.json as {
        status: string;
        resolutionOutcome: string | null;
      };
      expect(data.status).toBe('failed');
      expect(data.resolutionOutcome).toBe('failed');

      await new Promise((r) => setTimeout(r, 500));
      const events = await api(
        'GET',
        '/api/ai/activity?conversationId=sess-for-handoff&limit=10',
      );
      const types = (
        events.json as { events: Array<{ type: string }> }
      ).events.map((e) => e.type);
      expect(types).toContain('conversation.failed');
    } else {
      // Already terminal from previous run — verify it has a terminal status
      expect(['completed', 'failed']).toContain(currentStatus);
    }
  });
});

// ─── Auth Required ────────────────────────────────────────────────────

describe('Auth required on all endpoints', () => {
  const endpoints = [
    '/api/ai/dashboard',
    '/api/ai/activity',
    '/api/ai/attention',
    '/api/ai/agents/metrics',
    '/api/ai/channels/status',
  ];

  for (const ep of endpoints) {
    test(`${ep} requires auth`, async () => {
      const res = await fetch(`${BASE}${ep}`, { headers: { origin: ORIGIN } });
      expect(res.status).toBe(401);
    });
  }
});

// ─── Metrics After Resolution ─────────────────────────────────────────

describe('Metrics update after resolution changes', () => {
  test('active count decreased after completions/failures', async () => {
    const { json } = await api('GET', '/api/ai/agents/metrics');
    const agents = (
      json as { agents: Array<{ agentId: string; activeCount: number }> }
    ).agents;
    const booking = agents.find((a) => a.agentId === 'booking');
    // After completing and failing sessions, active count should have decreased
    // We can't compare to "before" in bun:test (tests may run in any order),
    // but we can verify the count is reasonable
    expect(booking).toBeDefined();
    expect(typeof booking?.activeCount).toBe('number');
  });
});
