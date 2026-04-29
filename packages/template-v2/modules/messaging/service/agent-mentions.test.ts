/**
 * Unit tests for the agent-mention resolver — uses real Postgres so the
 * Drizzle query against `agent_definitions` matches production semantics.
 *
 * Coverage maps to PRD US-201 acceptance criteria:
 *   - case-insensitive matching
 *   - longest-name precedence (`@Sentinelbot` != `@Sentinel`)
 *   - word-boundary disqualification (`@Sentinel.next`)
 *   - disabled agents excluded
 *   - cross-org agents excluded
 *   - deduplication when mentioned multiple times
 *   - composer-`mentions[]` intersection
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { agentDefinitions } from '@modules/agents/schema'
import { MERIDIAN_ORG_ID, MERIGPT_AGENT_ID } from '@modules/agents/seed'
import { eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { createAgentMentionsService } from './agent-mentions'

const OTHER_ORG_ID = 'org-test-other'

// Local throwaway agent ids — inserted in beforeAll, deleted in afterAll.
const SENTINEL_AGENT_ID = 'agt-test-sent'

let db: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()

  // Seed extra agents the suite owns: a disabled `Disabledora`, a `Sentinelbot`
  // (longest-precedence test), a cross-org `Sentinel` (org isolation test),
  // and a Meridian-org `Sentinel` for the scoping + dedup + intersection tests.
  await (db.db as unknown as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
    .insert(agentDefinitions)
    .values({
      id: 'agt-test-dis',
      organizationId: MERIDIAN_ORG_ID,
      name: 'Disabledora',
      enabled: false,
    })

  await (db.db as unknown as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
    .insert(agentDefinitions)
    .values({
      id: 'agt-test-sbot',
      organizationId: MERIDIAN_ORG_ID,
      name: 'Sentinelbot',
      enabled: true,
    })

  await (db.db as unknown as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
    .insert(agentDefinitions)
    .values({
      id: 'agt-test-xorg',
      organizationId: OTHER_ORG_ID,
      name: 'Sentinel',
      enabled: true,
    })

  // Meridian-org Sentinel for scoping, dedup, and intersection tests.
  await (db.db as unknown as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
    .insert(agentDefinitions)
    .values({
      id: SENTINEL_AGENT_ID,
      organizationId: MERIDIAN_ORG_ID,
      name: 'Sentinel',
      enabled: true,
    })
}, 60_000)

afterAll(async () => {
  if (!db) return
  // Best-effort cleanup so a re-run on the same DB without `db:reset` stays
  // sane. `db:reset` in `beforeAll` makes this redundant in CI but cheap.
  const handle = db.db as unknown as {
    delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> }
  }
  await handle.delete(agentDefinitions).where(eq(agentDefinitions.id, 'agt-test-dis'))
  await handle.delete(agentDefinitions).where(eq(agentDefinitions.id, 'agt-test-sbot'))
  await handle.delete(agentDefinitions).where(eq(agentDefinitions.id, 'agt-test-xorg'))
  await handle.delete(agentDefinitions).where(eq(agentDefinitions.id, SENTINEL_AGENT_ID))
  await db.teardown()
})

describe('createAgentMentionsService — resolveAgentMentionsInBody', () => {
  it('matches case-insensitively', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    const ids = await svc.resolveAgentMentionsInBody({
      body: '@merigpt can you take a look?',
      organizationId: MERIDIAN_ORG_ID,
    })
    expect(ids).toEqual([MERIGPT_AGENT_ID])
  })

  it('honours longest-name precedence: @Sentinelbot does NOT match @Sentinel', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    const ids = await svc.resolveAgentMentionsInBody({
      body: 'ping @Sentinelbot for details',
      organizationId: MERIDIAN_ORG_ID,
    })
    expect(ids).toContain('agt-test-sbot')
    expect(ids).not.toContain(SENTINEL_AGENT_ID)
  })

  it('respects word-boundary disqualification: @Sentinel.next is NOT a match', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    const ids = await svc.resolveAgentMentionsInBody({
      body: 'see @Sentinel.next for the diff',
      organizationId: MERIDIAN_ORG_ID,
    })
    expect(ids).not.toContain(SENTINEL_AGENT_ID)
    expect(ids).toEqual([])
  })

  it('filters out disabled agents (Disabledora is disabled)', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    const ids = await svc.resolveAgentMentionsInBody({
      body: '@Disabledora thoughts?',
      organizationId: MERIDIAN_ORG_ID,
    })
    expect(ids).toEqual([])
  })

  it('scopes by organization_id (cross-org Sentinel is excluded)', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    // Querying the OTHER org should match its Sentinel, not Meridian's.
    const otherIds = await svc.resolveAgentMentionsInBody({
      body: '@Sentinel ping',
      organizationId: OTHER_ORG_ID,
    })
    expect(otherIds).toEqual(['agt-test-xorg'])

    // And the Meridian-org query should match Meridian's Sentinel only.
    const meridianIds = await svc.resolveAgentMentionsInBody({
      body: '@Sentinel ping',
      organizationId: MERIDIAN_ORG_ID,
    })
    expect(meridianIds).toEqual([SENTINEL_AGENT_ID])
  })

  it('deduplicates repeated mentions of the same agent', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    const ids = await svc.resolveAgentMentionsInBody({
      body: '@Sentinel @Sentinel @Sentinel',
      organizationId: MERIDIAN_ORG_ID,
    })
    expect(ids).toEqual([SENTINEL_AGENT_ID])
  })

  it('intersects with composer mentions[] — body says MeriGPT, mentions[] only references Sentinel -> empty', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    const ids = await svc.resolveAgentMentionsInBody({
      body: 'hey @MeriGPT',
      organizationId: MERIDIAN_ORG_ID,
      mentions: [`agent:${SENTINEL_AGENT_ID}`],
    })
    expect(ids).toEqual([])
  })

  it('intersects with composer mentions[] — keeps the matching agent and ignores staff entries', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    const ids = await svc.resolveAgentMentionsInBody({
      body: '@Sentinel please review',
      organizationId: MERIDIAN_ORG_ID,
      mentions: [`agent:${SENTINEL_AGENT_ID}`, 'staff:usr-foo'],
    })
    expect(ids).toEqual([SENTINEL_AGENT_ID])
  })

  it('returns [] for empty bodies and bodies with no @-mentions', async () => {
    const svc = createAgentMentionsService({ db: db.db })
    expect(await svc.resolveAgentMentionsInBody({ body: '', organizationId: MERIDIAN_ORG_ID })).toEqual([])
    expect(await svc.resolveAgentMentionsInBody({ body: 'no mentions here', organizationId: MERIDIAN_ORG_ID })).toEqual(
      [],
    )
  })
})
