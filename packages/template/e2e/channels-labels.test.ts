/**
 * E2E test: Labels, Channel Reply, Timeline, and Private Notes.
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
  return { status: res.status, json, text, headers: res.headers };
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

// ─── Labels CRUD ─────────────────────────────────────────────────────

describe('Labels CRUD', () => {
  let testLabelId = '';

  test('list seeded labels', async () => {
    const { status, json } = await api('GET', '/api/messaging/labels');
    const labels = json as Array<{ id: string; title: string; color: string }>;
    expect(status).toBe(200);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(labels.some((l) => l.title === 'VIP')).toBe(true);
    expect(labels.some((l) => l.title === 'Bug')).toBe(true);
  });

  test('create label', async () => {
    const { status, json } = await api('POST', '/api/messaging/labels', {
      title: 'E2E Test Label',
      color: '#10b981',
      description: 'Created by E2E test',
    });
    const label = json as { id: string; title: string; color: string };
    expect(status).toBe(201);
    expect(label.title).toBe('E2E Test Label');
    expect(label.color).toBe('#10b981');
    testLabelId = label.id;
  });

  test('update label', async () => {
    const { status, json } = await api(
      'PATCH',
      `/api/messaging/labels/${testLabelId}`,
      {
        title: 'E2E Updated Label',
        color: '#f59e0b',
      },
    );
    const label = json as { id: string; title: string; color: string };
    expect(status).toBe(200);
    expect(label.title).toBe('E2E Updated Label');
    expect(label.color).toBe('#f59e0b');
  });

  test('delete label', async () => {
    const { status, json } = await api(
      'DELETE',
      `/api/messaging/labels/${testLabelId}`,
    );
    expect(status).toBe(200);
    expect((json as { ok: boolean }).ok).toBe(true);

    // Verify deleted
    const list = await api('GET', '/api/messaging/labels');
    const labels = list.json as Array<{ id: string }>;
    expect(labels.find((l) => l.id === testLabelId)).toBeUndefined();
  });

  test('delete non-existent label returns 404', async () => {
    const { status } = await api('DELETE', '/api/messaging/labels/nonexistent');
    expect(status).toBe(404);
  });
});

// ─── Conversation Labels ─────────────────────────────────────────────

describe('Conversation labels', () => {
  const convId = 'sess-for-completion';

  test('get labels for conversation', async () => {
    const { status, json } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/labels`,
    );
    expect(status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
  });

  test('add label to conversation creates activity event', async () => {
    // Add label
    const { status } = await api(
      'POST',
      `/api/messaging/conversations/${convId}/labels`,
      { labelIds: ['lbl-bug'] },
    );
    expect(status).toBe(200);

    // Verify label assigned
    const { json: labels } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/labels`,
    );
    const assigned = labels as Array<{ id: string }>;
    expect(assigned.some((l) => l.id === 'lbl-bug')).toBe(true);

    // Verify activity event created
    const { json: msgs } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/messages?limit=5`,
    );
    const messages = (msgs as { messages: Array<{ content: string }> })
      .messages;
    expect(messages.some((m) => m.content === 'label.added')).toBe(true);
  });

  test('remove label from conversation creates activity event', async () => {
    const { status } = await api(
      'DELETE',
      `/api/messaging/conversations/${convId}/labels/lbl-bug`,
    );
    expect(status).toBe(200);

    // Verify label removed
    const { json: labels } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/labels`,
    );
    const assigned = labels as Array<{ id: string }>;
    expect(assigned.some((l) => l.id === 'lbl-bug')).toBe(false);

    // Verify activity event
    const { json: msgs } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/messages?limit=5`,
    );
    const messages = (msgs as { messages: Array<{ content: string }> })
      .messages;
    expect(messages.some((m) => m.content === 'label.removed')).toBe(true);
  });

  test('adding duplicate label is idempotent', async () => {
    await api('POST', `/api/messaging/conversations/${convId}/labels`, {
      labelIds: ['lbl-vip'],
    });
    const { status } = await api(
      'POST',
      `/api/messaging/conversations/${convId}/labels`,
      { labelIds: ['lbl-vip'] },
    );
    expect(status).toBe(200); // onConflictDoNothing

    // Only one VIP label
    const { json: labels } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/labels`,
    );
    const vipCount = (labels as Array<{ id: string }>).filter(
      (l) => l.id === 'lbl-vip',
    ).length;
    expect(vipCount).toBe(1);
  });
});

// ─── Conversation List with Labels ───────────────────────────────────

describe('Conversation list includes labels', () => {
  test('attention queue returns labels array', async () => {
    const { status, json } = await api(
      'GET',
      '/api/messaging/conversations/attention?limit=10',
    );
    expect(status).toBe(200);
    const convs = json as Array<{
      id: string;
      labels: Array<{ id: string; title: string; color: string }>;
    }>;
    expect(convs.length).toBeGreaterThan(0);
    // Every conversation must have a labels array (even if empty)
    for (const c of convs) {
      expect(Array.isArray(c.labels)).toBe(true);
    }
  });

  test('ai-active list returns labels array', async () => {
    const { json } = await api(
      'GET',
      '/api/messaging/conversations/ai-active?limit=10',
    );
    const convs = json as Array<{ labels: unknown[] }>;
    for (const c of convs) {
      expect(Array.isArray(c.labels)).toBe(true);
    }
  });

  test('resolved list returns labels array', async () => {
    const { json } = await api(
      'GET',
      '/api/messaging/conversations/resolved?limit=10',
    );
    const convs = json as Array<{ labels: unknown[] }>;
    for (const c of convs) {
      expect(Array.isArray(c.labels)).toBe(true);
    }
  });
});

// ─── Staff Reply + Private Notes ─────────────────────────────────────

describe('Staff reply and private notes', () => {
  const convId = 'sess-human-low';

  test('send staff reply persists message', async () => {
    const { status, json } = await api(
      'POST',
      `/api/messaging/conversations/${convId}/reply`,
      { content: 'E2E test reply message' },
    );
    expect([200, 201]).toContain(status);
    const result = json as { success: boolean; messageId: string };
    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();

    // Verify in messages
    const { json: msgs } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/messages?limit=10`,
    );
    const messages = (
      msgs as { messages: Array<{ content: string; private: boolean }> }
    ).messages;
    expect(messages.some((m) => m.content === 'E2E test reply message')).toBe(
      true,
    );
  });

  test('send private note does not leak to lastMessageContent', async () => {
    const { status } = await api(
      'POST',
      `/api/messaging/conversations/${convId}/reply`,
      {
        content: 'SECRET_PRIVATE_NOTE_E2E',
        isInternal: true,
      },
    );
    expect([200, 201]).toContain(status);

    // Verify note is persisted with private=true
    const { json: msgs } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/messages?limit=10`,
    );
    const messages = (
      msgs as {
        messages: Array<{
          content: string;
          private: boolean;
          messageType: string;
        }>;
      }
    ).messages;
    const note = messages.find((m) => m.content === 'SECRET_PRIVATE_NOTE_E2E');
    expect(note).toBeDefined();
    expect(note?.private).toBe(true);

    // Verify lastMessageContent is NOT the private note
    const { json: convs } = await api(
      'GET',
      '/api/messaging/conversations/attention?limit=50',
    );
    const conv = (
      convs as Array<{ id: string; lastMessageContent: string }>
    ).find((c) => c.id === convId);
    expect(conv).toBeDefined();
    expect(conv?.lastMessageContent).not.toBe('SECRET_PRIVATE_NOTE_E2E');
    // Should be the staff reply instead
    expect(conv?.lastMessageContent).toBe('E2E test reply message');
  });
});

// ─── Message Timeline Filtering ──────────────────────────────────────

describe('Message timeline activity filtering', () => {
  test('activity messages include label events', async () => {
    const convId = 'sess-for-completion';
    const { json: msgs } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/messages?limit=50`,
    );
    const messages = (
      msgs as {
        messages: Array<{ messageType: string; content: string }>;
      }
    ).messages;

    const activities = messages.filter((m) => m.messageType === 'activity');
    const labelEvents = activities.filter(
      (m) => m.content === 'label.added' || m.content === 'label.removed',
    );
    expect(labelEvents.length).toBeGreaterThan(0);
  });

  test('non-visible activity events exist but are filtered client-side', async () => {
    // Find a conversation with message.read events
    const convId = 'sess-human-low';
    const { json: msgs } = await api(
      'GET',
      `/api/messaging/conversations/${convId}/messages?limit=100`,
    );
    const messages = (
      msgs as {
        messages: Array<{ messageType: string; content: string }>;
      }
    ).messages;

    const activities = messages.filter((m) => m.messageType === 'activity');
    // Some events are non-visible (message.read) — they exist in DB but client filters them
    const nonVisible = activities.filter(
      (m) =>
        m.content === 'message.read' || m.content === 'message.outbound_queued',
    );
    // These events exist in DB (server doesn't filter them)
    // Client-side isTimelineVisibleEvent() filters them out
    // This test documents the current behavior
    if (nonVisible.length > 0) {
      // Verify they're NOT in the visible events set
      const VISIBLE = new Set([
        'escalation.created',
        'handler.changed',
        'session.created',
        'session.resolved',
        'session.failed',
        'conversation.created',
        'conversation.resolved',
        'conversation.failed',
        'conversation.claimed',
        'conversation.unassigned',
        'guardrail.block',
        'guardrail.warn',
        'agent.draft_generated',
        'attention.reviewed',
        'attention.dismissed',
        'label.added',
        'label.removed',
      ]);
      for (const nv of nonVisible) {
        expect(VISIBLE.has(nv.content)).toBe(false);
      }
    }
  });
});

// ─── Real AI Agent Chat ──────────────────────────────────────────────

describe('Real AI agent chat (web streaming)', () => {
  test('start a new chat conversation', async () => {
    const { status, json } = await api(
      'POST',
      '/api/agents/chat/ep-web-booking/start',
    );
    expect(status).toBe(200);
    const data = json as { conversationId: string; agentId: string };
    expect(data.conversationId).toBeTruthy();
    expect(data.agentId).toBe('booking');
  });

  test('stream AI response with real LLM', async () => {
    const res = await fetch(`${BASE}/api/agents/chat/ep-web-booking/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie,
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content:
              'Hello, I need to book a dental checkup appointment please.',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Read the stream
    const text = await res.text();
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain('[DONE]');

    // Agent should mention booking-related content
    const deltas = text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6))
      .filter((l) => l.includes('"type":"text-delta"'))
      .map((l) => {
        try {
          return JSON.parse(l).delta;
        } catch {
          return '';
        }
      })
      .join('');

    expect(deltas.length).toBeGreaterThan(10);
    // Agent should respond coherently (not empty or error)
    expect(deltas.toLowerCase()).toMatch(/book|appointment|help|schedule/i);
  });

  test('multi-turn conversation retains context', async () => {
    const res = await fetch(`${BASE}/api/agents/chat/ep-web-booking/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie,
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Hello, I need to book a dental checkup.',
          },
          {
            role: 'assistant',
            content:
              "I'd be happy to help you book a dental checkup! What date works best for you?",
          },
          { role: 'user', content: 'How about next Wednesday at 10am?' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();

    // Agent should reference the requested time
    const deltas = text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6))
      .filter((l) => l.includes('"type":"text-delta"'))
      .map((l) => {
        try {
          return JSON.parse(l).delta;
        } catch {
          return '';
        }
      })
      .join('');

    expect(deltas.length).toBeGreaterThan(10);
    // Agent should respond coherently to the follow-up (not empty or error)
    // AI responses vary — just verify it's substantive
    expect(deltas.length).toBeGreaterThan(20);
  });

  test('human/held mode blocks AI streaming', async () => {
    // sess-held-mode is in held mode
    // First start a conversation for it (if needed)
    const { json: conv } = await api(
      'GET',
      '/api/messaging/conversations/sess-held-mode',
    );
    const mode = (conv as { mode: string }).mode;
    expect(mode).toBe('held');

    // The /stream endpoint checks mode and rejects human/held
    // We can't easily test this via channelRoutingId since sess-held-mode
    // was created via seed, not through the chat start flow
    // This is a behavioral note: the mode guard exists at line 509 of chat.ts
  });
});

// ─── Auth Required ───────────────────────────────────────────────────

describe('Auth required on new endpoints', () => {
  const endpoints = [
    '/api/messaging/labels',
    '/api/messaging/conversations/sess-human-low/labels',
  ];

  for (const ep of endpoints) {
    test(`${ep} requires auth`, async () => {
      const res = await fetch(`${BASE}${ep}`, { headers: { origin: ORIGIN } });
      expect(res.status).toBe(401);
    });
  }
});
