/**
 * Race-safety + TTL behaviour for pending-mention pings.
 *
 * Uses a real Postgres seed (the canonical `connectTestDb` + reset pattern)
 * because the claim path relies on a SQL CTE atomic DELETE-RETURNING that
 * cannot be exercised against a mock.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { pendingMentionPings } from '@modules/team/schema'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import {
  __resetPendingMentionPingServiceForTests,
  claimPing,
  createPendingMentionPingService,
  installPendingMentionPingService,
  PING_TTL_MS,
  recordPing,
} from './pending-mention-pings'

const ORG_A = 'org-test-aaaa'
const ORG_B = 'org-test-bbbb'
const STAFF_X = 'usr-test-x'
const CONV_1 = 'conv-test-1'
const CONV_2 = 'conv-test-2'
const AGENT_1 = 'agt-test-1'
const NOTE_1 = 'note-test-1'

let db: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  installPendingMentionPingService(createPendingMentionPingService({ db: db.db }))
}, 60_000)

afterAll(async () => {
  __resetPendingMentionPingServiceForTests()
  if (db) {
    const del = db.db as unknown as {
      delete: (t: unknown) => { where?: (c: unknown) => Promise<unknown> } & Promise<unknown>
    }
    await del.delete(pendingMentionPings)
    await db.teardown()
  }
})

describe('pending-mention-pings', () => {
  it('records and claims a ping', async () => {
    await recordPing({
      conversationId: CONV_1,
      staffUserId: STAFF_X,
      organizationId: ORG_A,
      askingAgentId: AGENT_1,
      originalNoteId: NOTE_1,
    })
    const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
    expect(claimed?.conversationId).toBe(CONV_1)
    expect(claimed?.askingAgentId).toBe(AGENT_1)
    expect(claimed?.originalNoteId).toBe(NOTE_1)

    // Second claim returns null — row was atomically deleted.
    const second = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
    expect(second).toBeNull()
  })

  it('refuses cross-tenant collision (delta C3)', async () => {
    await recordPing({
      conversationId: CONV_1,
      staffUserId: STAFF_X,
      organizationId: ORG_A,
      askingAgentId: AGENT_1,
      originalNoteId: NOTE_1,
    })
    // Org B asking for STAFF_X's pings sees nothing — the row belongs to ORG_A.
    const wrongOrg = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_B })
    expect(wrongOrg).toBeNull()

    // ORG_A still has its row.
    const correct = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
    expect(correct?.conversationId).toBe(CONV_1)
  })

  it('upserts on (conversation, staff) — refreshes asking agent + note', async () => {
    await recordPing({
      conversationId: CONV_1,
      staffUserId: STAFF_X,
      organizationId: ORG_A,
      askingAgentId: AGENT_1,
      originalNoteId: NOTE_1,
    })
    await recordPing({
      conversationId: CONV_1,
      staffUserId: STAFF_X,
      organizationId: ORG_A,
      askingAgentId: 'agt-test-2',
      originalNoteId: 'note-test-2',
    })
    const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
    expect(claimed?.askingAgentId).toBe('agt-test-2')
    expect(claimed?.originalNoteId).toBe('note-test-2')
  })

  it('picks the freshest row when two conversations have pings for the same staff', async () => {
    await recordPing({
      conversationId: CONV_1,
      staffUserId: STAFF_X,
      organizationId: ORG_A,
      askingAgentId: AGENT_1,
      originalNoteId: NOTE_1,
    })
    // Small wait so created_at is strictly later — Postgres timestamps have
    // microsecond resolution but the ORM round-trips as Date.
    await new Promise((r) => setTimeout(r, 5))
    await recordPing({
      conversationId: CONV_2,
      staffUserId: STAFF_X,
      organizationId: ORG_A,
      askingAgentId: 'agt-test-2',
      originalNoteId: 'note-test-2',
    })
    const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
    expect(claimed?.conversationId).toBe(CONV_2)
  })

  it('sanity: PING_TTL_MS is 30 minutes', () => {
    expect(PING_TTL_MS).toBe(30 * 60 * 1000)
  })
})
