/**
 * Unit tests for `loadMessagingIndexContributors` — the `/INDEX.md` open-
 * conversations summary block. Stubs `ConversationsService.list` so cases
 * have no DB dependency.
 */

import { describe, expect, it } from 'bun:test'
import type { Conversation } from '@modules/messaging/schema'

import {
  assertContributorRespectsBuildTarget,
  assertContributorSwallowsErrors,
  TEST_ORG_ID as ORG_ID,
} from '../../tests/helpers/index-contributor'
import { loadMessagingIndexContributors, type MessagingIndexReader } from './agent'

function fakeConv(overrides: Partial<Conversation>): Conversation {
  return {
    id: overrides.id ?? 'c1',
    organizationId: ORG_ID,
    contactId: overrides.contactId ?? 'cont1',
    channelInstanceId: overrides.channelInstanceId ?? 'ch1',
    threadKey: null,
    assignee: overrides.assignee ?? 'unassigned',
    status: overrides.status ?? 'active',
    snoozedUntil: null,
    snoozedAt: null,
    snoozedBy: null,
    snoozeReason: null,
    createdAt: new Date('2026-04-26T00:00:00Z'),
    updatedAt: new Date('2026-04-26T00:00:00Z'),
    lastMessageAt: overrides.lastMessageAt ?? new Date('2026-04-26T00:00:00Z'),
    ...overrides,
  } as Conversation
}

function makeReader(rows: Conversation[]): MessagingIndexReader {
  return {
    list(_orgId, _opts) {
      return Promise.resolve(rows)
    },
  }
}

describe('loadMessagingIndexContributors', () => {
  it('returns null render when there are no open conversations', async () => {
    const contribs = await loadMessagingIndexContributors({ organizationId: ORG_ID, conversations: makeReader([]) })
    expect(contribs).toHaveLength(1)
    expect(contribs[0].render({ file: 'INDEX.md' })).toBeNull()
  })

  it('renders a heading + one bullet per open conversation up to the limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      fakeConv({ id: `c${i}`, contactId: `cont${i}`, channelInstanceId: `ch${i}`, assignee: `u${i}` }),
    )
    const contribs = await loadMessagingIndexContributors({ organizationId: ORG_ID, conversations: makeReader(rows) })
    const out = contribs[0].render({ file: 'INDEX.md' })
    expect(out).toContain('# Open Conversations (3)')
    expect(out).toContain('/contacts/cont0/ch0/messages.md')
    expect(out).toContain('assignee=u0')
    expect(out).toContain('/contacts/cont1/ch1/messages.md')
    expect(out).toContain('/contacts/cont2/ch2/messages.md')
  })

  it('truncates beyond 10 entries and emits an overflow line', async () => {
    const rows = Array.from({ length: 13 }, (_, i) =>
      fakeConv({ id: `c${i}`, contactId: `cont${i}`, channelInstanceId: `ch${i}` }),
    )
    const contribs = await loadMessagingIndexContributors({ organizationId: ORG_ID, conversations: makeReader(rows) })
    const out = contribs[0].render({ file: 'INDEX.md' }) ?? ''
    const bullets = out.split('\n').filter((l) => l.startsWith('- /contacts/'))
    expect(bullets).toHaveLength(10)
    expect(out).toContain('… and 3 more')
  })

  it('swallows reader errors and yields an empty section', async () => {
    await assertContributorSwallowsErrors<MessagingIndexReader>(
      (input) =>
        loadMessagingIndexContributors(input as unknown as Parameters<typeof loadMessagingIndexContributors>[0]),
      'conversations',
      'list',
    )
  })

  it('contributor file matches INDEX.md so it joins the right build target', async () => {
    await assertContributorRespectsBuildTarget<MessagingIndexReader>(
      (input) =>
        loadMessagingIndexContributors(input as unknown as Parameters<typeof loadMessagingIndexContributors>[0]),
      'conversations',
      makeReader([fakeConv({ id: 'c1' })]),
      'Open Conversations',
    )
  })
})
