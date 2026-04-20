import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { PendingApproval } from '@server/contracts/domain-types'
import * as realQuery from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@tanstack/react-query', () => ({
  ...realQuery,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (String(queryKey[0]) === 'approvals') {
      return {
        data: [makePendingApproval({ id: 'a1', conversationId: 'conv_123', toolName: 'send_card' })],
      }
    }
    return { data: [] }
  },
  useMutation: () => ({ mutate: mock(() => {}), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: mock(() => {}), getQueryData: mock(() => undefined) }),
}))

mock.module('sonner', () => ({ toast: { success: mock(() => {}) } }))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePendingApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'approval_abc',
    tenantId: 'tenant_meridian',
    conversationId: 'conv_123',
    conversationEventId: null,
    toolName: 'send_card',
    toolArgs: { template: 'pricing', contactId: 'c_001' },
    status: 'pending',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    agentSnapshot: null,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    ...overrides,
  }
}

// ─── Pure function tests (real implementations via globalThis.fetch) ───────────

import { decideApproval, fetchApprovals } from '@modules/inbox/api/use-decide-approval'

describe('fetchApprovals', () => {
  it('returns parsed JSON on 200', async () => {
    const approvals = [makePendingApproval({ id: 'a1' }), makePendingApproval({ id: 'a2' })]
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(approvals), { status: 200 })),
    ) as unknown as typeof fetch

    const result = await fetchApprovals()
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('a1')
  })

  it('throws on non-200', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('error', { status: 500 }))) as unknown as typeof fetch

    await expect(fetchApprovals()).rejects.toThrow('Failed to fetch approvals')
  })
})

describe('decideApproval — approve', () => {
  let capturedUrl: string
  let capturedBody: Record<string, unknown>

  beforeEach(() => {
    capturedUrl = ''
    capturedBody = {}
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = init?.body ? JSON.parse(init.body as string) : {}
      return new Response(JSON.stringify({ ok: true, approvalId: 'approval_abc' }), { status: 200 })
    }) as unknown as typeof fetch
  })

  it('POSTs to correct URL', async () => {
    await decideApproval({ id: 'approval_abc', conversationId: 'conv_123', decision: 'approved' })
    expect(capturedUrl).toBe('/api/inbox/approvals/approval_abc')
  })

  it('sends decision=approved in body', async () => {
    await decideApproval({ id: 'approval_abc', conversationId: 'conv_123', decision: 'approved' })
    expect(capturedBody.decision).toBe('approved')
  })

  it('sends decidedByUserId in body', async () => {
    await decideApproval({
      id: 'approval_abc',
      conversationId: 'conv_123',
      decision: 'approved',
      decidedByUserId: 'user_staff_01',
    })
    expect(capturedBody.decidedByUserId).toBe('user_staff_01')
  })
})

describe('decideApproval — reject', () => {
  it('sends decision=rejected in body', async () => {
    let capturedBody: Record<string, unknown> = {}
    globalThis.fetch = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : {}
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    await decideApproval({ id: 'approval_rej', conversationId: 'conv_123', decision: 'rejected' })
    expect(capturedBody.decision).toBe('rejected')
  })

  it('throws on non-200', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('Conflict', { status: 409 }))) as unknown as typeof fetch

    await expect(
      decideApproval({ id: 'approval_rej', conversationId: 'conv_123', decision: 'rejected' }),
    ).rejects.toThrow('Failed to decide approval')
  })
})

// ─── PendingApprovalsPanel structural tests ───────────────────────────────────

import { PendingApprovalsPanel } from '../pending-approvals-panel'

describe('PendingApprovalsPanel — renders with approvals', () => {
  it('shows tool name', () => {
    const html = renderToStaticMarkup(<PendingApprovalsPanel conversationId="conv_123" />)
    expect(html).toContain('send_card')
  })

  it('shows Approve button', () => {
    const html = renderToStaticMarkup(<PendingApprovalsPanel conversationId="conv_123" />)
    expect(html).toContain('Approve')
  })

  it('shows Reject button', () => {
    const html = renderToStaticMarkup(<PendingApprovalsPanel conversationId="conv_123" />)
    expect(html).toContain('Reject')
  })

  it('shows warning color for awaiting_approval status dot', () => {
    const html = renderToStaticMarkup(<PendingApprovalsPanel conversationId="conv_123" />)
    expect(html).toContain('color-warning')
  })
})

describe('PendingApprovalsPanel — empty state', () => {
  it('shows empty state when no approvals match conversationId', () => {
    const html = renderToStaticMarkup(<PendingApprovalsPanel conversationId="conv_other" />)
    expect(html).toContain('No pending approvals')
  })
})
