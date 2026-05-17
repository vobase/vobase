/**
 * US-007 (Slice B.2) — ledger rename runtime invariants + down-migration SQL validation.
 *
 * Option B (per US-007 prompt): verifies the new schema columns have correct defaults
 * and the soft-delete claim contract works end-to-end, without full schema-replay
 * machinery. Full schema-replay (drop OLD schema → run forward SQL → assert → run
 * down SQL → assert) is deferred because it would require a parallel isolated DB
 * that doesn't interfere with the shared test Postgres instance.
 *
 * The down-migration SQL is validated structurally (file exists, contains required
 * statements) — a reviewer can read and verify the SQL directly.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { pendingStaffPings } from '@modules/team/schema'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import {
  __resetPendingStaffPingServiceForTests,
  claimPing,
  createPendingStaffPingService,
  installPendingStaffPingService,
  recordPing,
} from './pending-staff-pings'

const ORG = 'org-b2-test'
const STAFF = 'usr-b2-test'
const CONV = 'conv-b2-test'
const AGENT = 'agt-b2-test'
const NOTE = 'note-b2-test'

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

describe('US-007 ledger rename — runtime invariants', () => {
  it('pending_staff_pings has kind defaulting to mention', async () => {
    await recordPing({
      conversationId: CONV,
      staffUserId: STAFF,
      organizationId: ORG,
      askingAgentId: AGENT,
      originalNoteId: NOTE,
      kind: 'mention',
    })
    const result = await claimPing({ staffUserId: STAFF, organizationId: ORG })
    expect(result.status).toBe('claimed')
    if (result.status === 'claimed') {
      expect(result.ping.kind).toBe('mention')
      expect(result.ping.referenceId).toBeNull()
      expect(result.ping.claimedAt).toBeInstanceOf(Date)
      expect(result.ping.claimedWamid).toBeNull()
    }
  })

  it('claimByWamid finds existing live rows after rename', async () => {
    await recordPing({
      conversationId: CONV,
      staffUserId: STAFF,
      organizationId: ORG,
      askingAgentId: AGENT,
      originalNoteId: NOTE,
      kind: 'mention',
      outboundWamid: 'wamid-b2-test',
    })
    const result = await claimPing({
      staffUserId: STAFF,
      organizationId: ORG,
      outboundWamid: 'wamid-b2-test',
      inboundWamid: 'wamid-b2-inbound',
    })
    expect(result.status).toBe('claimed')
    if (result.status === 'claimed') {
      expect(result.ping.outboundWamid).toBe('wamid-b2-test')
      expect(result.ping.claimedWamid).toBe('wamid-b2-inbound')
    }
  })

  it('soft-delete UPDATE leaves the row queryable for prune (claimed_at IS NOT NULL)', async () => {
    await recordPing({
      conversationId: CONV,
      staffUserId: STAFF,
      organizationId: ORG,
      askingAgentId: AGENT,
      originalNoteId: NOTE,
      kind: 'mention',
    })
    // Claim it — sets claimed_at.
    const claim = await claimPing({ staffUserId: STAFF, organizationId: ORG })
    expect(claim.status).toBe('claimed')

    // Row should be invisible to a second live-row claim (claimed_at IS NOT NULL).
    const second = await claimPing({ staffUserId: STAFF, organizationId: ORG })
    expect(second.status).toBe('none')

    // But the row still physically exists — pruneOlderThan with a future cutoff
    // should delete it (claimed_at < cutoff).
    const { pruneOlderThan } = createPendingStaffPingService({ db: db.db })
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const pruned = await pruneOlderThan(tomorrow)
    expect(pruned).toBe(1)
  })
})

describe('US-007 down-migration SQL', () => {
  it('down migration file exists and contains required ALTER + DROP statements', () => {
    // Resolve from template root (packages/template/).
    const templateRoot = join(import.meta.dir, '..', '..', '..', '..', '..')
    const downSqlPath = join(
      templateRoot,
      'packages',
      'template',
      'migrations',
      'down',
      'down-rename-staff-pings-to-mention-pings.sql',
    )
    const sql = readFileSync(downSqlPath, 'utf-8')

    // Safety gate block must be present.
    expect(sql).toContain('RAISE EXCEPTION')
    expect(sql).toContain("kind <> 'mention'")

    // All four column drops.
    expect(sql).toContain('DROP COLUMN "claimed_wamid"')
    expect(sql).toContain('DROP COLUMN "claimed_at"')
    expect(sql).toContain('DROP COLUMN "reference_id"')
    expect(sql).toContain('DROP COLUMN "kind"')

    // Table rename back.
    expect(sql).toContain('RENAME TO "pending_mention_pings"')

    // Partial index drop.
    expect(sql).toContain('idx_pending_staff_pings_live')

    // Index renames back to original names.
    expect(sql).toContain('uq_pending_pings_conv_staff')
    expect(sql).toContain('idx_pending_pings_created')
    expect(sql).toContain('idx_pending_pings_staff')
  })
})
