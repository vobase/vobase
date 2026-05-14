/**
 * Claim-ladder + TTL behaviour for pending-mention pings.
 *
 * Uses a real Postgres seed (the canonical `connectTestDb` + reset pattern)
 * because every claim path is a SQL CTE atomic DELETE-RETURNING that cannot be
 * exercised against a mock. The table is cleared between tests so each case
 * starts from an empty ledger.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
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
const AGENT_2 = 'agt-test-2'
const NOTE_1 = 'note-test-1'
const NOTE_2 = 'note-test-2'

let db: TestDbHandle

async function clearPings(): Promise<void> {
  const del = db.db as unknown as { delete: (t: unknown) => Promise<unknown> }
  await del.delete(pendingMentionPings)
}

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  installPendingMentionPingService(createPendingMentionPingService({ db: db.db }))
}, 60_000)

afterEach(async () => {
  if (db) await clearPings()
})

afterAll(async () => {
  __resetPendingMentionPingServiceForTests()
  if (db) {
    await clearPings()
    await db.teardown()
  }
})

describe('pending-mention-pings', () => {
  describe('count-aware fallback (no wamid)', () => {
    it("claims the staff member's sole live ping", async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
      })
      const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(claimed.status).toBe('claimed')
      if (claimed.status === 'claimed') {
        expect(claimed.ping.conversationId).toBe(CONV_1)
        expect(claimed.ping.askingAgentId).toBe(AGENT_1)
        expect(claimed.ping.originalNoteId).toBe(NOTE_1)
      }
      // Claimed atomically — a second claim sees an empty ledger.
      const second = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(second.status).toBe('none')
    })

    it('returns none when the staff member has no live ping', async () => {
      const result = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(result.status).toBe('none')
    })

    it('returns ambiguous and claims nothing when 2+ live pings exist', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
      })
      await recordPing({
        conversationId: CONV_2,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
      })
      const result = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(result.status).toBe('ambiguous')
      if (result.status === 'ambiguous') expect(result.liveCount).toBe(2)
      // Nothing was claimed — both rows are still live, so it stays ambiguous.
      const again = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(again.status).toBe('ambiguous')
    })

    it('scopes the claim to the org — cross-tenant pings are invisible', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
      })
      const wrongOrg = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_B })
      expect(wrongOrg.status).toBe('none')
      const correct = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(correct.status).toBe('claimed')
    })
  })

  describe('exact wamid match (reply gesture)', () => {
    it('claims the exact ping by outbound wamid even when other pings exist', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        outboundWamid: 'wamid-1',
      })
      await recordPing({
        conversationId: CONV_2,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        outboundWamid: 'wamid-2',
      })
      const result = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A, outboundWamid: 'wamid-2' })
      expect(result.status).toBe('claimed')
      if (result.status === 'claimed') {
        expect(result.ping.conversationId).toBe(CONV_2)
        expect(result.ping.outboundWamid).toBe('wamid-2')
      }
      // The other ping is untouched and is now the sole live one.
      const rest = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(rest.status).toBe('claimed')
      if (rest.status === 'claimed') expect(rest.ping.conversationId).toBe(CONV_1)
    })

    it('falls through to count-aware when the wamid does not match', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        outboundWamid: 'wamid-1',
      })
      // Unknown wamid → no exact hit → the sole live ping is claimed.
      const result = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A, outboundWamid: 'wamid-unknown' })
      expect(result.status).toBe('claimed')
      if (result.status === 'claimed') expect(result.ping.conversationId).toBe(CONV_1)
    })

    it('a wamid miss with 2+ live pings is still ambiguous', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        outboundWamid: 'wamid-1',
      })
      await recordPing({
        conversationId: CONV_2,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        outboundWamid: 'wamid-2',
      })
      const result = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A, outboundWamid: 'wamid-unknown' })
      expect(result.status).toBe('ambiguous')
    })
  })

  describe('recordPing', () => {
    it('upserts on (conversation, staff) — refreshes asking agent, note, and wamid', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        outboundWamid: 'wamid-old',
      })
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        outboundWamid: 'wamid-new',
      })
      const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(claimed.status).toBe('claimed')
      if (claimed.status === 'claimed') {
        expect(claimed.ping.askingAgentId).toBe(AGENT_2)
        expect(claimed.ping.originalNoteId).toBe(NOTE_2)
        expect(claimed.ping.outboundWamid).toBe('wamid-new')
      }
    })

    it('defaults outboundWamid to null when omitted', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
      })
      const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(claimed.status).toBe('claimed')
      if (claimed.status === 'claimed') expect(claimed.ping.outboundWamid).toBeNull()
    })
  })

  it('sanity: PING_TTL_MS is 30 minutes', () => {
    expect(PING_TTL_MS).toBe(30 * 60 * 1000)
  })
})
