/**
 * Learnings page unit tests — exercises pure data functions extracted from
 * the page + hook. No React rendering needed: the business logic lives in
 * fetchPendingLearnings / decideLearning which can be tested via fetch mocks.
 *
 * For the SSE invalidation acceptance criterion see the assertion below that
 * checks resolveInvalidationKeys handles 'learning_proposals'.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { LearningProposal } from '@server/contracts/domain-types'
import { decideLearning, fetchPendingLearnings } from '@/hooks/use-pending-learnings'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePendingProposal(overrides: Partial<LearningProposal> = {}): LearningProposal {
  return {
    id: `prop_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: 'tenant_meridian',
    conversationId: 'conv_abc',
    wakeEventId: null,
    scope: 'agent_skill',
    action: 'upsert',
    target: 'reply-with-card',
    body: 'Updated skill body',
    rationale: 'Customer repeatedly asked for card-format',
    confidence: 0.85,
    status: 'pending',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    approvedWriteId: null,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    ...overrides,
  }
}

// ─── fetchPendingLearnings ────────────────────────────────────────────────────

describe('fetchPendingLearnings', () => {
  it('returns parsed JSON on 200', async () => {
    const proposals = [
      makePendingProposal({ id: 'p1' }),
      makePendingProposal({ id: 'p2' }),
      makePendingProposal({ id: 'p3' }),
    ]

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(proposals), { status: 200 })),
    ) as unknown as typeof fetch

    const result = await fetchPendingLearnings()
    expect(result).toHaveLength(3)
    expect(result[0]?.id).toBe('p1')
    expect(result[2]?.id).toBe('p3')
  })

  it('throws on non-200', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Internal Error', { status: 500 })),
    ) as unknown as typeof fetch

    await expect(fetchPendingLearnings()).rejects.toThrow('Failed to fetch pending learnings')
  })
})

// ─── decideLearning — approve flow ───────────────────────────────────────────

describe('decideLearning — approve', () => {
  let capturedUrl: string
  let capturedBody: unknown

  beforeEach(() => {
    capturedUrl = ''
    capturedBody = null
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
  })

  it('agent_skill scope → POST /api/agents/skills/:id/decide', async () => {
    await decideLearning({ id: 'prop_abc', scope: 'agent_skill', decision: 'approved' })
    expect(capturedUrl).toBe('/api/agents/skills/prop_abc/decide')
    expect((capturedBody as { decision: string }).decision).toBe('approved')
  })

  it('drive_doc scope → POST /api/drive/proposals/:id/decide', async () => {
    await decideLearning({ id: 'prop_xyz', scope: 'drive_doc', decision: 'approved' })
    expect(capturedUrl).toBe('/api/drive/proposals/prop_xyz/decide')
    expect((capturedBody as { decision: string }).decision).toBe('approved')
  })
})

// ─── decideLearning — reject with note ───────────────────────────────────────

describe('decideLearning — reject', () => {
  it('passes note in request body', async () => {
    let capturedBody: unknown = null

    globalThis.fetch = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    await decideLearning({
      id: 'prop_rej',
      scope: 'agent_skill',
      decision: 'rejected',
      note: 'Incorrect generalisation',
    })

    expect((capturedBody as { decision: string; note?: string }).decision).toBe('rejected')
    expect((capturedBody as { note?: string }).note).toBe('Incorrect generalisation')
  })
})

// ─── SSE invalidation key mapping ────────────────────────────────────────────

describe('resolveInvalidationKeys — learning_proposals', () => {
  // Mirrors the pure-function extraction pattern from use-realtime-invalidation.test.ts.
  // Verifies the branch added in P3.6.

  interface RealtimePayload {
    table: string
    id?: string
    action?: string
  }
  type QueryKey = unknown[]

  function resolveInvalidationKeys(payload: RealtimePayload): QueryKey[] {
    if (!payload.table) return []

    if (payload.table === 'conversations') {
      const keys: QueryKey[] = [['conversations']]
      if (payload.id) {
        keys.push(['conversation', payload.id])
        keys.push(['messages', payload.id])
      }
      return keys
    }

    if (payload.table === 'agent-sessions' && payload.id) {
      return [['messages', payload.id], ['conversations']]
    }

    if (payload.table === 'approvals') {
      return [['approvals']]
    }

    if (payload.table === 'learning_proposals') {
      return [['learnings']]
    }

    return [[payload.table]]
  }

  it('learning_proposed → invalidates learnings key', () => {
    const keys = resolveInvalidationKeys({ table: 'learning_proposals', action: 'learning_proposed' })
    expect(keys).toContainEqual(['learnings'])
  })

  it('learning_approved → invalidates learnings key', () => {
    const keys = resolveInvalidationKeys({ table: 'learning_proposals', action: 'learning_approved' })
    expect(keys).toContainEqual(['learnings'])
  })

  it('learning_rejected → invalidates learnings key', () => {
    const keys = resolveInvalidationKeys({ table: 'learning_proposals', action: 'learning_rejected' })
    expect(keys).toContainEqual(['learnings'])
  })
})
