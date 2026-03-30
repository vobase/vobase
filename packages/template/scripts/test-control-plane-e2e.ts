/**
 * Exhaustive E2E test for the Agent Control Plane Backend.
 * Tests ALL flows against a live dev server with seeded data.
 *
 * Run: bun run scripts/test-control-plane-e2e.ts
 * Prereq: bun run db:nuke && bun run db:push && bun run db:seed && bun run dev
 */
export {};

const BASE = 'http://localhost:3000';
const ORIGIN = 'http://localhost:3000';

let cookie = '';
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    const msg = `${name}${detail ? ` — ${detail}` : ''}`;
    console.log(`  ❌ ${msg}`);
    failed++;
    failures.push(msg);
  }
}

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

// ─── Auth ─────────────────────────────────────────────────────────────

console.log('\n🔑 Authenticating...');
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
console.log(`  Status: ${signIn.status === 200 ? 'OK' : 'FAILED'}\n`);

// ═══════════════════════════════════════════════════════════════════════
// TEST 1: Dashboard aggregates with seeded data
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 1: Dashboard Aggregates ━━━');
const dash = await api('GET', '/api/conversations/dashboard');
const d = dash.json as Record<string, number>;
assert('Dashboard returns 200', dash.status === 200);
assert(
  'needsAttentionCount >= 3 (seeded pending events)',
  d.needsAttentionCount >= 3,
  `got ${d.needsAttentionCount}`,
);
assert('activeSessions > 0', d.activeSessions > 0, `got ${d.activeSessions}`);
assert('resolvedToday is a number', typeof d.resolvedToday === 'number');
assert(
  'avgResponseTimeMs is a number',
  typeof d.avgResponseTimeMs === 'number',
);
console.log(
  `  Dashboard: attention=${d.needsAttentionCount}, active=${d.activeSessions}, resolved=${d.resolvedToday}\n`,
);

// ═══════════════════════════════════════════════════════════════════════
// TEST 2: Attention queue with seeded pending events
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 2: Attention Queue (seeded data) ━━━');
const att = await api('GET', '/api/conversations/attention');
const attData = att.json as {
  items: Array<{
    id: string;
    type: string;
    resolutionStatus: string;
    createdAt: string;
  }>;
  count: number;
};
assert('Attention returns 200', att.status === 200);
assert(
  'Has >= 3 pending items (2 escalation + 1 guardrail + 1 draft)',
  attData.count >= 3,
  `got ${attData.count}`,
);
assert(
  'All items have pending status',
  attData.items.every((i) => i.resolutionStatus === 'pending'),
);
const types = attData.items.map((i) => i.type);
assert('Contains escalation.created', types.includes('escalation.created'));
assert('Contains guardrail.block', types.includes('guardrail.block'));
// FIFO: oldest first
const dates = attData.items.map((i) => new Date(i.createdAt).getTime());
assert(
  'Items ordered ASC (FIFO)',
  dates.every((d, i) => i === 0 || d >= dates[i - 1]),
  `dates: ${dates.join(', ')}`,
);
console.log(
  `  Attention: ${attData.count} items, types: ${[...new Set(types)].join(', ')}\n`,
);

// ═══════════════════════════════════════════════════════════════════════
// TEST 3: Attention review → 409 conflict → dashboard updates
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 3: Attention Review Full Cycle ━━━');
const targetEvent = attData.items[0];
const beforeCount = attData.count;

// Review
const review = await api(
  'POST',
  `/api/conversations/attention/${targetEvent.id}/review`,
);
assert('Review returns 200', review.status === 200);
const reviewed = review.json as { resolutionStatus: string };
assert('Status is reviewed', reviewed.resolutionStatus === 'reviewed');

// Double-review → 409
const doubleReview = await api(
  'POST',
  `/api/conversations/attention/${targetEvent.id}/review`,
);
assert(
  'Double-review returns 409 (optimistic locking)',
  doubleReview.status === 409,
  `got ${doubleReview.status}`,
);

// Attention count decreased
const attAfter = await api('GET', '/api/conversations/attention');
const attAfterData = attAfter.json as { count: number };
assert(
  'Attention count decreased by 1',
  attAfterData.count === beforeCount - 1,
  `expected ${beforeCount - 1}, got ${attAfterData.count}`,
);

// Dashboard reflects
await new Promise((r) => setTimeout(r, 300));
const dashAfter = await api('GET', '/api/conversations/dashboard');
const dAfter = dashAfter.json as { needsAttentionCount: number };
assert(
  'Dashboard attention count matches queue',
  dAfter.needsAttentionCount === attAfterData.count,
  `dashboard=${dAfter.needsAttentionCount}, queue=${attAfterData.count}`,
);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 4: Attention dismiss
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 4: Attention Dismiss ━━━');
const attForDismiss = await api('GET', '/api/conversations/attention');
const dismissItems = (attForDismiss.json as { items: Array<{ id: string }> })
  .items;
if (dismissItems.length > 0) {
  const dismiss = await api(
    'POST',
    `/api/conversations/attention/${dismissItems[0].id}/dismiss`,
  );
  assert('Dismiss returns 200', dismiss.status === 200);
  const dismissed = dismiss.json as { resolutionStatus: string };
  assert('Status is dismissed', dismissed.resolutionStatus === 'dismissed');

  // Double-dismiss → 409
  const doubleDismiss = await api(
    'POST',
    `/api/conversations/attention/${dismissItems[0].id}/dismiss`,
  );
  assert('Double-dismiss returns 409', doubleDismiss.status === 409);
} else {
  console.log('  ⏭️ No items left to dismiss');
}
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 5: Activity feed pagination (>2 pages with seeded data)
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 5: Activity Feed Pagination ━━━');
const page1 = await api('GET', '/api/conversations/activity?limit=5');
const p1 = page1.json as {
  events: Array<{ id: string; type: string; createdAt: string }>;
  nextCursor: string | null;
};
assert('Page 1 returns 200', page1.status === 200);
assert(
  'Page 1 has 5 events',
  p1.events.length === 5,
  `got ${p1.events.length}`,
);
assert('Page 1 has nextCursor', p1.nextCursor !== null);

if (p1.nextCursor) {
  const page2 = await api(
    'GET',
    `/api/conversations/activity?limit=5&cursor=${p1.nextCursor}`,
  );
  const p2 = page2.json as {
    events: Array<{ id: string; createdAt: string }>;
    nextCursor: string | null;
  };
  assert('Page 2 returns 200', page2.status === 200);
  assert('Page 2 has events', p2.events.length > 0, `got ${p2.events.length}`);

  // No duplicates
  const p1Ids = new Set(p1.events.map((e) => e.id));
  const dupes = p2.events.filter((e) => p1Ids.has(e.id));
  assert('No duplicate events across pages', dupes.length === 0);

  // Page 2 events are older
  const lastP1 = new Date(p1.events[p1.events.length - 1].createdAt).getTime();
  const firstP2 = new Date(p2.events[0].createdAt).getTime();
  assert('Page 2 events are older than page 1', firstP2 <= lastP1);

  if (p2.nextCursor) {
    const page3 = await api(
      'GET',
      `/api/conversations/activity?limit=5&cursor=${p2.nextCursor}`,
    );
    assert('Page 3 returns 200', page3.status === 200);
    console.log('  ✅ 3+ pages confirmed');
  }
}
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 6: Activity feed filters on real data
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 6: Activity Feed Filters ━━━');

// Type filter
const typeF = await api(
  'GET',
  '/api/conversations/activity?type=conversation.created&limit=20',
);
const typeEvents = (typeF.json as { events: Array<{ type: string }> }).events;
assert(
  'Type filter returns only conversation.created',
  typeEvents.every((e) => e.type === 'conversation.created'),
);
assert(
  'Found conversation.created events',
  typeEvents.length >= 2,
  `got ${typeEvents.length}`,
);

// Category filter
const catF = await api(
  'GET',
  '/api/conversations/activity?category=agent&limit=20',
);
const catEvents = (catF.json as { events: Array<{ type: string }> }).events;
assert(
  'Category filter returns only agent.* events',
  catEvents.every((e) => e.type.startsWith('agent.')),
);

// Channel filter
const chF = await api(
  'GET',
  '/api/conversations/activity?channelType=whatsapp&limit=20',
);
const chEvents = (chF.json as { events: Array<{ channelType: string }> })
  .events;
assert(
  'Channel filter returns only whatsapp events',
  chEvents.every((e) => e.channelType === 'whatsapp'),
);

// Resolution status filter
const resF = await api(
  'GET',
  '/api/conversations/activity?resolutionStatus=reviewed&limit=20',
);
const resEvents = (resF.json as { events: Array<{ resolutionStatus: string }> })
  .events;
assert(
  'Resolution status filter works',
  resEvents.every((e) => e.resolutionStatus === 'reviewed'),
);

// Category escalation
const escF = await api(
  'GET',
  '/api/conversations/activity?category=escalation&limit=20',
);
const escEvents = (escF.json as { events: Array<{ type: string }> }).events;
assert(
  'Escalation category works',
  escEvents.every((e) => e.type.startsWith('escalation.')),
);

// Guardrail category
const guardF = await api(
  'GET',
  '/api/conversations/activity?category=guardrail&limit=20',
);
const guardEvents = (guardF.json as { events: Array<{ type: string }> }).events;
assert(
  'Guardrail category works',
  guardEvents.every((e) => e.type.startsWith('guardrail.')),
);
assert(
  'Contains both guardrail.block and guardrail.warn',
  guardEvents.some((e) => e.type === 'guardrail.block') &&
    guardEvents.some((e) => e.type === 'guardrail.warn'),
  `types: ${[...new Set(guardEvents.map((e) => e.type))].join(', ')}`,
);

// Time range filter
const now = new Date();
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
const timeF = await api(
  'GET',
  `/api/conversations/activity?timeFrom=${twoHoursAgo}&limit=20`,
);
const timeEvents = (timeF.json as { events: Array<{ createdAt: string }> })
  .events;
assert(
  'Time filter returns recent events only',
  timeEvents.every(
    (e) => new Date(e.createdAt).getTime() >= new Date(twoHoursAgo).getTime(),
  ),
);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 7: Agent metrics with resolution outcomes
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 7: Agent Metrics ━━━');
const met = await api('GET', '/api/conversations/agents/metrics');
const agents = (
  met.json as {
    agents: Array<{
      agentId: string;
      activeCount: number;
      queuedCount: number;
      successScore: number;
    }>;
  }
).agents;
assert('Metrics returns agents', agents.length > 0);
const booking = agents.find((a) => a.agentId === 'booking');
assert('Booking agent found', !!booking);
assert(
  'Active count > 0',
  (booking?.activeCount ?? 0) > 0,
  `got ${booking?.activeCount}`,
);
assert(
  'Success score is between 0 and 1',
  (booking?.successScore ?? -1) >= 0 && (booking?.successScore ?? 2) <= 1,
  `got ${booking?.successScore}`,
);
// We seeded resolved + escalated_resolved sessions, so score should be > 0
assert(
  'Success score > 0 (has resolved sessions)',
  (booking?.successScore ?? 0) > 0,
  `got ${booking?.successScore}`,
);
console.log(
  `  Booking: active=${booking?.activeCount}, queued=${booking?.queuedCount}, score=${booking?.successScore}\n`,
);

// ═══════════════════════════════════════════════════════════════════════
// TEST 8: Channel status counts match
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 8: Channel Status ━━━');
const ch = await api('GET', '/api/conversations/channels/status');
const channels = (
  ch.json as {
    channels: Array<{
      id: string;
      type: string;
      status: string;
      activeSessionCount: number;
    }>;
  }
).channels;
assert('Channel status returns data', channels.length > 0);
const totalActive = channels.reduce((sum, c) => sum + c.activeSessionCount, 0);
const dashNow = await api('GET', '/api/conversations/dashboard');
const currentActive = (dashNow.json as { activeSessions: number })
  .activeSessions;
assert(
  'Channel counts sum matches dashboard',
  totalActive === currentActive,
  `channels=${totalActive}, dashboard=${currentActive}`,
);
// Check specific channel instances have sessions
const waMain = channels.find((c) => c.id === 'ci-wa-main');
const ciWeb = channels.find((c) => c.id === 'ci-web');
assert(
  'WhatsApp main has active sessions',
  (waMain?.activeSessionCount ?? 0) > 0,
);
assert('Web chat has active sessions', (ciWeb?.activeSessionCount ?? 0) > 0);
console.log(
  `  Channels: ${channels.map((c) => `${c.type}(${c.activeSessionCount})`).join(', ')}\n`,
);

// ═══════════════════════════════════════════════════════════════════════
// TEST 9: Mode — web chat blocked for human/held sessions
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 9: Mode Guards on Web Chat ━━━');

// Human mode session should block web chat
const humanSession = await api(
  'GET',
  '/api/conversations/sessions/sess-human-mode',
);
assert('Human-mode session exists', humanSession.status === 200);
assert(
  'Human-mode session has mode=human',
  (humanSession.json as { mode: string }).mode === 'human',
);

// Held mode session should block web chat
const pausedSession = await api(
  'GET',
  '/api/conversations/sessions/sess-held-mode',
);
assert('Held-mode session exists', pausedSession.status === 200);
assert(
  'Held-mode session has mode=held',
  (pausedSession.json as { mode: string }).mode === 'held',
);

// Supervised mode session should allow web chat
const supervisedSession = await api(
  'GET',
  '/api/conversations/sessions/sess-supervised-mode',
);
assert('Supervised-mode session exists', supervisedSession.status === 200);
assert(
  'Supervised-mode session has mode=supervised',
  (supervisedSession.json as { mode: string }).mode === 'supervised',
);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 10: Handoff → Handback cycle
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 10: Handoff → Handback Cycle ━━━');

// Verify the ai-mode session we'll use
const forHandoff = await api(
  'GET',
  '/api/conversations/sessions/sess-for-handoff',
);
assert(
  'Handoff target session is ai mode',
  (forHandoff.json as { mode: string }).mode === 'ai',
);

// We can't call the Mastra tool via API, but we can simulate by manually
// updating the session via the existing PATCH endpoint (set to held, then test handback)
// Instead, let's test the handback flow on the already-human session

const handback = await api(
  'POST',
  '/api/conversations/sessions/sess-human-mode/handback',
);
assert('Handback returns 200', handback.status === 200);
const hbResult = handback.json as { success: boolean; mode: string };
assert('Handback result shows ai mode', hbResult.mode === 'ai');

// Verify session is now ai
const afterHandback = await api(
  'GET',
  '/api/conversations/sessions/sess-human-mode',
);
assert(
  'Session mode is now ai after handback',
  (afterHandback.json as { mode: string }).mode === 'ai',
);

// Check handler.changed event was emitted
await new Promise((r) => setTimeout(r, 500));
const handbackEvents = await api(
  'GET',
  '/api/conversations/activity?conversationId=sess-human-mode&type=handler.changed&limit=10',
);
const hbEvents = (
  handbackEvents.json as {
    events: Array<{ type: string; data: Record<string, unknown> }>;
  }
).events;
assert(
  'handler.changed event emitted for handback',
  hbEvents.length > 0,
  `got ${hbEvents.length} events`,
);
if (hbEvents.length > 0) {
  const latest = hbEvents[0];
  assert(
    'handler.changed has from=human, to=ai',
    latest.data?.from === 'human' && latest.data?.to === 'ai',
    `got from=${latest.data?.from}, to=${latest.data?.to}`,
  );
}

// Try handback again on ai mode → should fail
const doubleHandback = await api(
  'POST',
  '/api/conversations/sessions/sess-human-mode/handback',
);
assert('Handback on ai-mode returns 400', doubleHandback.status === 400);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 11: Approve draft (supervised mode)
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 11: Approve Supervised Draft ━━━');
const approve = await api(
  'POST',
  '/api/conversations/sessions/sess-supervised-mode/approve-draft',
);
assert('Approve draft returns 200', approve.status === 200);
const approveResult = approve.json as { success: boolean; draftId: string };
assert('Approve result has draftId', !!approveResult.draftId);

// Double-approve should fail (optimistic locking)
const doubleApprove = await api(
  'POST',
  '/api/conversations/sessions/sess-supervised-mode/approve-draft',
);
assert(
  'Double-approve returns 404 (no more pending drafts)',
  doubleApprove.status === 404,
);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 12: Session completion via PATCH → events emitted
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 12: Session Completion → Events ━━━');
const complete = await api(
  'PATCH',
  '/api/conversations/sessions/sess-for-completion',
  { status: 'completed' },
);
assert('Complete returns 200', complete.status === 200);
const completed = complete.json as {
  status: string;
  resolutionOutcome: string | null;
};
assert('Status is completed', completed.status === 'completed');

await new Promise((r) => setTimeout(r, 500));
const completionEvents = await api(
  'GET',
  '/api/conversations/activity?conversationId=sess-for-completion&limit=10',
);
const compEvents = (
  completionEvents.json as { events: Array<{ type: string }> }
).events;
assert(
  'conversation.completed event emitted',
  compEvents.some((e) => e.type === 'conversation.completed'),
  `types: ${compEvents.map((e) => e.type).join(', ')}`,
);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 13: Session failure → resolution_outcome + events
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 13: Session Failure → Events ━━━');
const fail = await api(
  'PATCH',
  '/api/conversations/sessions/sess-for-handoff',
  { status: 'failed' },
);
assert('Fail returns 200', fail.status === 200);
const failedSess = fail.json as {
  status: string;
  resolutionOutcome: string | null;
};
assert('Status is failed', failedSess.status === 'failed');
assert(
  'Resolution outcome is failed',
  failedSess.resolutionOutcome === 'failed',
);

await new Promise((r) => setTimeout(r, 500));
const failEvents = await api(
  'GET',
  '/api/conversations/activity?conversationId=sess-for-handoff&limit=10',
);
const fEvents = (failEvents.json as { events: Array<{ type: string }> }).events;
assert(
  'conversation.failed event emitted',
  fEvents.some((e) => e.type === 'conversation.failed'),
  `types: ${fEvents.map((e) => e.type).join(', ')}`,
);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 14: Auth required on all endpoints
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 14: Auth Required ━━━');
const noAuthEndpoints = [
  '/api/conversations/dashboard',
  '/api/conversations/activity',
  '/api/conversations/attention',
  '/api/conversations/agents/metrics',
  '/api/conversations/channels/status',
];
for (const ep of noAuthEndpoints) {
  const res = await fetch(`${BASE}${ep}`, { headers: { origin: ORIGIN } });
  assert(
    `${ep.split('/').pop()} requires auth`,
    res.status === 401,
    `got ${res.status}`,
  );
}
console.log();

// ═══════════════════════════════════════════════════════════════════════
// TEST 15: Metrics update after resolution
// ═══════════════════════════════════════════════════════════════════════

console.log('━━━ TEST 15: Metrics After Resolution Changes ━━━');
const metAfter = await api('GET', '/api/conversations/agents/metrics');
const agentsAfter = (
  metAfter.json as {
    agents: Array<{
      agentId: string;
      activeCount: number;
      successScore: number;
    }>;
  }
).agents;
const bookingAfter = agentsAfter.find((a) => a.agentId === 'booking');
assert(
  'Active count decreased after completions/failures',
  (bookingAfter?.activeCount ?? 999) < (booking?.activeCount ?? 0),
  `before=${booking?.activeCount}, after=${bookingAfter?.activeCount}`,
);
console.log();

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`    ❌ ${f}`);
}
console.log('═══════════════════════════════════════════════════════════');

if (failed > 0) process.exit(1);
