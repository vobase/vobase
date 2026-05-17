/**
 * Claim-ladder + TTL behaviour for pending-staff pings.
 *
 * Uses a real Postgres seed (the canonical `connectTestDb` + reset pattern)
 * because every claim path is a SQL CTE atomic UPDATE-RETURNING (soft-delete)
 * that cannot be exercised against a mock. The table is cleared between tests
 * so each case starts from an empty ledger.
 *
 * Updated in US-007 (Slice B.2): `pending_mention_pings` → `pending_staff_pings`,
 * DELETE…RETURNING → soft-delete UPDATE…SET claimed_at, new `kind` column.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { pendingStaffPings } from '@modules/team/schema'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import {
  __resetPendingStaffPingServiceForTests,
  claimPing,
  createPendingStaffPingService,
  installPendingStaffPingService,
  PING_TTL_MS,
  recordPing,
} from './pending-staff-pings'

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
  await del.delete(pendingStaffPings)
}

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  installPendingStaffPingService(createPendingStaffPingService({ db: db.db }))
}, 60_000)

afterEach(async () => {
  if (db) await clearPings()
})

afterAll(async () => {
  __resetPendingStaffPingServiceForTests()
  if (db) {
    await clearPings()
    await db.teardown()
  }
})

describe('pending-staff-pings', () => {
  describe('count-aware fallback (no wamid)', () => {
    it("claims the staff member's sole live ping", async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        kind: 'mention',
      })
      const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(claimed.status).toBe('claimed')
      if (claimed.status === 'claimed') {
        expect(claimed.ping.conversationId).toBe(CONV_1)
        expect(claimed.ping.askingAgentId).toBe(AGENT_1)
        expect(claimed.ping.originalNoteId).toBe(NOTE_1)
        expect(claimed.ping.kind).toBe('mention')
        expect(claimed.ping.claimedAt).toBeInstanceOf(Date)
      }
      // Claimed via soft-delete — a second claim sees no live rows (claimed_at IS NOT NULL).
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
        kind: 'mention',
      })
      await recordPing({
        conversationId: CONV_2,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        kind: 'mention',
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
        kind: 'mention',
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
        kind: 'mention',
        outboundWamid: 'wamid-1',
      })
      await recordPing({
        conversationId: CONV_2,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        kind: 'mention',
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
        kind: 'mention',
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
        kind: 'mention',
        outboundWamid: 'wamid-1',
      })
      await recordPing({
        conversationId: CONV_2,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        kind: 'mention',
        outboundWamid: 'wamid-2',
      })
      const result = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A, outboundWamid: 'wamid-unknown' })
      expect(result.status).toBe('ambiguous')
    })

    it('stores the inboundWamid in claimed_wamid on soft-delete', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        kind: 'mention',
        outboundWamid: 'wamid-out-1',
      })
      const result = await claimPing({
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        outboundWamid: 'wamid-out-1',
        inboundWamid: 'wamid-in-reply',
      })
      expect(result.status).toBe('claimed')
      if (result.status === 'claimed') {
        expect(result.ping.claimedWamid).toBe('wamid-in-reply')
        expect(result.ping.claimedAt).toBeInstanceOf(Date)
      }
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
        kind: 'mention',
        outboundWamid: 'wamid-old',
      })
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        kind: 'mention',
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
        kind: 'mention',
      })
      const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(claimed.status).toBe('claimed')
      if (claimed.status === 'claimed') expect(claimed.ping.outboundWamid).toBeNull()
    })

    it('defaults referenceId to null for mention kind', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        kind: 'mention',
      })
      const claimed = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(claimed.status).toBe('claimed')
      if (claimed.status === 'claimed') {
        expect(claimed.ping.referenceId).toBeNull()
        expect(claimed.ping.kind).toBe('mention')
      }
    })

    it('re-ping resets claim state — upsert on already-claimed row makes it live again', async () => {
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_1,
        originalNoteId: NOTE_1,
        kind: 'mention',
      })
      // Claim it once.
      const first = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(first.status).toBe('claimed')
      // Row is now claimed (claimed_at IS NOT NULL). Re-ping should reset it.
      await recordPing({
        conversationId: CONV_1,
        staffUserId: STAFF_X,
        organizationId: ORG_A,
        askingAgentId: AGENT_2,
        originalNoteId: NOTE_2,
        kind: 'mention',
      })
      // Should be live again with updated fields.
      const second = await claimPing({ staffUserId: STAFF_X, organizationId: ORG_A })
      expect(second.status).toBe('claimed')
      if (second.status === 'claimed') {
        expect(second.ping.askingAgentId).toBe(AGENT_2)
        expect(second.ping.claimedAt).toBeInstanceOf(Date)
      }
    })
  })

  it('sanity: PING_TTL_MS is 30 minutes', () => {
    expect(PING_TTL_MS).toBe(30 * 60 * 1000)
  })
})
