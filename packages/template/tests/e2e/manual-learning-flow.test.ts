/**
 * E2E: manual "learn from this thread" — producer → triage handler.
 *
 * Exercises the real seam end-to-end against Postgres: the producer
 * (`messaging/service/manual-learning`) resolves the agent for a backfilled,
 * unassigned WhatsApp-coexistence conversation, chunks it, and enqueues triage
 * jobs; the handler (`wake/learning/triage-job`) classifies each window and
 * writes `learning_candidates`. The scheduler runs the handler inline (no
 * pg-boss) so the whole flow is deterministic.
 *
 * No LLM key needed — triage runs in stub mode (worth_attention keyed off the
 * window body length), so substantive history yields candidates.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import {
  __resetLearningCandidatesServiceForTests,
  createLearningCandidatesService,
  installLearningCandidatesService,
} from '@modules/agents/service/learning-candidates'
import { createManualLearningService } from '@modules/messaging/service/manual-learning'
import { sql } from 'drizzle-orm'

import { getSeededOrgId } from '~/tests/helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import {
  __resetTriageDepsForTests,
  handleTriageJobForTest,
  installTriageDeps,
  type LearningTriageJobPayload,
} from '~/wake/learning/triage-job'

const stubRealtime = {
  async notify(_payload: unknown) {},
  subscribe(_fn: (payload: string) => void): () => void {
    return () => {}
  },
  async shutdown() {},
}

let dbh: TestDbHandle
let organizationId: string

const CI_ID = 'ci-mlflow'
const CONV_ID = 'conv-mlflow'

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  organizationId = await getSeededOrgId(dbh.db)
  installLearningCandidatesService(
    createLearningCandidatesService({
      db: dbh.db as unknown as Parameters<typeof createLearningCandidatesService>[0]['db'],
      realtime: stubRealtime,
    }),
  )
  installTriageDeps({ db: dbh.db as unknown as Parameters<typeof installTriageDeps>[0]['db'] })
}, 60_000)

afterAll(async () => {
  __resetLearningCandidatesServiceForTests()
  __resetTriageDepsForTests()
  await dbh.teardown()
})

beforeEach(async () => {
  await dbh.db.execute(
    sql`TRUNCATE agents.learning_candidates, messaging.conversations, messaging.messages, channels.channel_instances CASCADE`,
  )
})

/** Runs the triage handler inline for each enqueued window. */
function inlineService() {
  return createManualLearningService({
    db: dbh.db as unknown as Parameters<typeof createManualLearningService>[0]['db'],
    triageScheduler: {
      publish: async (_name, payload: LearningTriageJobPayload) => {
        await handleTriageJobForTest(payload)
      },
    },
  })
}

async function seedBackfilledThread(channelConfig: Record<string, unknown>): Promise<void> {
  await dbh.db.execute(
    sql`INSERT INTO contacts.contacts (id, organization_id, display_name)
        VALUES ('contact-mlflow', ${organizationId}, 'History')
        ON CONFLICT (id) DO NOTHING`,
  )
  await dbh.db.execute(
    sql`INSERT INTO channels.channel_instances (id, organization_id, channel, role, config, status)
        VALUES (${CI_ID}, ${organizationId}, 'whatsapp', 'customer', ${JSON.stringify(channelConfig)}::jsonb, 'active')`,
  )
  await dbh.db.execute(
    sql`INSERT INTO messaging.conversations
          (id, organization_id, contact_id, channel_instance_id, status, assignee, thread_key)
        VALUES (${CONV_ID}, ${organizationId}, 'contact-mlflow', ${CI_ID}, 'active', 'unassigned', 'default')`,
  )
  await dbh.db.execute(
    sql`INSERT INTO messaging.messages (id, conversation_id, organization_id, role, kind, content, metadata, created_at)
        SELECT 'mf-' || g, ${CONV_ID}, ${organizationId}, 'customer', 'text',
               jsonb_build_object('text', 'Historical message ' || g || ': customer wants a premium order before noon.'),
               '{"historical": true}'::jsonb,
               now() - (interval '1 minute' * (10 - g))
        FROM generate_series(1, 5) g`,
  )
}

function candidateRows(): Promise<Array<Record<string, unknown>>> {
  return dbh.db.execute(sql`SELECT agent_id, signal_kind, status FROM agents.learning_candidates`)
}

describe('manual learning flow — backfilled WhatsApp history', () => {
  it('resolves the channel default agent and writes a learning candidate', async () => {
    await seedBackfilledThread({ defaultAssignee: `agent:${MERIGPT_AGENT_ID}` })

    const result = await inlineService().triggerLearning({ conversationId: CONV_ID })

    expect(result.agentId).toBe(MERIGPT_AGENT_ID)
    expect(result.windowCount).toBe(1)

    const rows = await candidateRows()
    expect(rows.length).toBe(1)
    expect(rows[0]?.agent_id).toBe(MERIGPT_AGENT_ID)
    expect(rows[0]?.signal_kind).toBe('manual')
    expect(rows[0]?.status).toBe('pending')
  }, 60_000)

  it('respects an explicit agentId override over the channel default', async () => {
    await seedBackfilledThread({ defaultAssignee: 'agent:some-other-agent' })

    const result = await inlineService().triggerLearning({ conversationId: CONV_ID, agentId: MERIGPT_AGENT_ID })

    expect(result.agentId).toBe(MERIGPT_AGENT_ID)
    const rows = await candidateRows()
    expect(rows.length).toBe(1)
    expect(rows[0]?.agent_id).toBe(MERIGPT_AGENT_ID)
  }, 60_000)
})
