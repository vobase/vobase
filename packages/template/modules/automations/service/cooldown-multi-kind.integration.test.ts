/**
 * Cross-kind cooldown integration (US-009 / Slice B.4).
 *
 * Verifies the multi-kind independence guarantee + the followup-bypass
 * semantics end-to-end against a real Postgres `pending_staff_pings` table.
 * Unit-level predicate behaviour (stubbed DB) lives in `cooldown.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { pendingStaffPings } from '@modules/team/schema'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { shouldSuppress } from './cooldown'

const ORG = 'org-cd-mk'
const STAFF = 'usr-cd-mk'
const CONV = 'conv-cd-mk'
const AGENT = 'agt-cd-mk'
const NOTE = 'note-cd-mk'

let dbH: TestDbHandle

async function clearPings(): Promise<void> {
  const del = dbH.db as unknown as { delete: (t: unknown) => Promise<unknown> }
  await del.delete(pendingStaffPings)
}

async function insertPing(kind: 'mention' | 'approval' | 'proposal', opts: { claimed: boolean }): Promise<void> {
  const ins = dbH.db as unknown as {
    insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> }
  }
  await ins.insert(pendingStaffPings).values({
    organizationId: ORG,
    conversationId: CONV,
    staffUserId: STAFF,
    askingAgentId: AGENT,
    originalNoteId: NOTE,
    kind,
    claimedAt: opts.claimed ? new Date() : null,
  })
}

beforeAll(async () => {
  await resetAndSeedDb()
  dbH = connectTestDb()
}, 60_000)

afterEach(async () => {
  if (dbH) await clearPings()
})

afterAll(async () => {
  if (dbH) {
    await clearPings()
    await dbH.teardown()
  }
})

describe('cooldown across kinds (integration)', () => {
  it('same (staff, conv) pinged for mention then approval within 1 min — both fire', async () => {
    await insertPing('mention', { claimed: false })
    // Mention is now in cooldown.
    expect(
      await shouldSuppress(
        { staffUserId: STAFF, conversationId: CONV, organizationId: ORG, kind: 'mention' },
        { db: dbH.db },
      ),
    ).toBe(true)
    // Approval is a separate key — must NOT be suppressed.
    expect(
      await shouldSuppress(
        { staffUserId: STAFF, conversationId: CONV, organizationId: ORG, kind: 'approval' },
        { db: dbH.db },
      ),
    ).toBe(false)
    // Proposal — also independent.
    expect(
      await shouldSuppress(
        { staffUserId: STAFF, conversationId: CONV, organizationId: ORG, kind: 'proposal' },
        { db: dbH.db },
      ),
    ).toBe(false)
  })

  it("followup bypass: claimed prior + reason='followup' → not suppressed", async () => {
    await insertPing('mention', { claimed: true })
    expect(
      await shouldSuppress(
        { staffUserId: STAFF, conversationId: CONV, organizationId: ORG, kind: 'mention', reason: 'followup' },
        { db: dbH.db },
      ),
    ).toBe(false)
  })

  it('followup respects cooldown when only unclaimed prior exists', async () => {
    await insertPing('mention', { claimed: false })
    expect(
      await shouldSuppress(
        { staffUserId: STAFF, conversationId: CONV, organizationId: ORG, kind: 'mention', reason: 'followup' },
        { db: dbH.db },
      ),
    ).toBe(true)
  })
})
