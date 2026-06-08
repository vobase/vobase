/**
 * Integration tests for the manual "learn from this thread" producer.
 *
 * Requires a running Docker Postgres (`docker compose up -d`).
 * No LLM key needed — the producer only resolves the agent, renders + chunks
 * the conversation, and enqueues one `learning:triage` job per window. The
 * triage classifier itself runs later in the job handler (tested separately).
 */

import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import { sql } from 'drizzle-orm'

import { getSeededOrgId } from '~/tests/helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import { LEARNING_TRIAGE_JOB, type LearningTriageJobPayload } from '~/wake/learning/triage-job'
import {
  createManualLearningService,
  ManualLearningError,
  type ManualLearningService,
  type ManualLearningTriageScheduler,
} from './manual-learning'

// ─── Harness ──────────────────────────────────────────────────────────────────

let dbh: TestDbHandle
let organizationId: string
let svc: ManualLearningService

const published: Array<{ name: string; payload: LearningTriageJobPayload }> = []
const fakeScheduler: ManualLearningTriageScheduler = {
  publish: async (name, payload) => {
    published.push({ name, payload })
  },
}

const CI_ID = 'ci-ml-1'
const CONV_ID = 'conv-ml-1'

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  organizationId = await getSeededOrgId(dbh.db)
  svc = createManualLearningService({
    db: dbh.db as unknown as Parameters<typeof createManualLearningService>[0]['db'],
    triageScheduler: fakeScheduler,
  })
}, 60_000)

afterEach(() => {
  published.length = 0
  // Restore window knobs that individual tests may override.
  delete process.env.LEARN_MANUAL_WINDOW
  delete process.env.LEARN_MANUAL_MAX_WINDOWS
})

// ─── Fixtures ───────────────────────────────────────────────────────────────

async function seedConversation(opts: {
  assignee: string
  channelConfig: Record<string, unknown>
  messageCount: number
}): Promise<void> {
  await dbh.db.execute(sql`TRUNCATE messaging.conversations, messaging.messages, channels.channel_instances CASCADE`)
  await dbh.db.execute(
    sql`INSERT INTO contacts.contacts (id, organization_id, display_name)
        VALUES ('contact-ml-1', ${organizationId}, 'ML Tester')
        ON CONFLICT (id) DO NOTHING`,
  )
  await dbh.db.execute(
    sql`INSERT INTO channels.channel_instances (id, organization_id, channel, role, config, status)
        VALUES (${CI_ID}, ${organizationId}, 'whatsapp', 'customer', ${JSON.stringify(opts.channelConfig)}::jsonb, 'active')`,
  )
  await dbh.db.execute(
    sql`INSERT INTO messaging.conversations
          (id, organization_id, contact_id, channel_instance_id, status, assignee, thread_key)
        VALUES (${CONV_ID}, ${organizationId}, 'contact-ml-1', ${CI_ID}, 'active', ${opts.assignee}, 'default')`,
  )
  if (opts.messageCount > 0) {
    // Chronological customer messages, each substantive enough for triage.
    await dbh.db.execute(
      sql`INSERT INTO messaging.messages (id, conversation_id, organization_id, role, kind, content, created_at)
          SELECT 'm-' || g, ${CONV_ID}, ${organizationId}, 'customer', 'text',
                 jsonb_build_object('text', 'Message number ' || g || ' about premium order delivery windows.'),
                 now() - (interval '1 minute' * (${opts.messageCount + 1} - g))
          FROM generate_series(1, ${opts.messageCount}) g`,
    )
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('manual learning producer — triggerLearning', () => {
  it('renders the thread into one window and enqueues a manual triage job', async () => {
    await seedConversation({ assignee: 'unassigned', channelConfig: {}, messageCount: 3 })

    const result = await svc.triggerLearning({ conversationId: CONV_ID, agentId: MERIGPT_AGENT_ID })

    expect(result.agentId).toBe(MERIGPT_AGENT_ID)
    expect(result.messageCount).toBe(3)
    expect(result.windowCount).toBe(1)

    expect(published.length).toBe(1)
    const job = published[0]
    expect(job?.name).toBe(LEARNING_TRIAGE_JOB)
    expect(job?.payload.agentId).toBe(MERIGPT_AGENT_ID)
    expect(job?.payload.conversationId).toBe(CONV_ID)
    expect(job?.payload.organizationId).toBe(organizationId)
    expect(job?.payload.signal.kind).toBe('manual')
    if (job?.payload.signal.kind === 'manual') {
      expect(job.payload.signal.windowRef.startsWith('manual:w0:')).toBe(true)
      expect(job.payload.signal.body).toContain('Message number 1')
      expect(job.payload.signal.body).toContain('Message number 3')
    }
  }, 30_000)

  it('chunks a long thread into multiple windows with distinct refs', async () => {
    // Default window size is 20 → 25 messages = one full window + a partial.
    await seedConversation({ assignee: 'unassigned', channelConfig: {}, messageCount: 25 })

    const result = await svc.triggerLearning({ conversationId: CONV_ID, agentId: MERIGPT_AGENT_ID })

    expect(result.messageCount).toBe(25)
    expect(result.windowCount).toBe(2)
    expect(published.length).toBe(2)
    const refs = published.map((p) => (p.payload.signal.kind === 'manual' ? p.payload.signal.windowRef : ''))
    expect(new Set(refs).size).toBe(2)
    expect(refs[0]?.startsWith('manual:w0:')).toBe(true)
    expect(refs[1]?.startsWith('manual:w1:')).toBe(true)
  }, 30_000)

  describe('agent resolution', () => {
    it('uses the conversation assignee when no agentId is passed', async () => {
      await seedConversation({ assignee: `agent:${MERIGPT_AGENT_ID}`, channelConfig: {}, messageCount: 2 })
      const result = await svc.triggerLearning({ conversationId: CONV_ID })
      expect(result.agentId).toBe(MERIGPT_AGENT_ID)
      expect(published[0]?.payload.agentId).toBe(MERIGPT_AGENT_ID)
    }, 30_000)

    it('falls back to the channel-instance default agent for an unassigned thread', async () => {
      // The WhatsApp-coexistence backfill case: history conversations land
      // `unassigned`, so the channel default is the only attribution available.
      await seedConversation({
        assignee: 'unassigned',
        channelConfig: { defaultAssignee: `agent:${MERIGPT_AGENT_ID}` },
        messageCount: 2,
      })
      const result = await svc.triggerLearning({ conversationId: CONV_ID })
      expect(result.agentId).toBe(MERIGPT_AGENT_ID)
    }, 30_000)

    it('throws no_agent when nothing resolves', async () => {
      await seedConversation({ assignee: 'unassigned', channelConfig: {}, messageCount: 2 })
      let err: unknown
      try {
        await svc.triggerLearning({ conversationId: CONV_ID })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(ManualLearningError)
      expect((err as ManualLearningError).code).toBe('no_agent')
      expect(published.length).toBe(0)
    }, 30_000)

    it('ignores a staff (user:) assignee and a non-agent channel default', async () => {
      await seedConversation({
        assignee: 'user:staff-1',
        channelConfig: { defaultAssignee: 'user:staff-2' },
        messageCount: 2,
      })
      let err: unknown
      try {
        await svc.triggerLearning({ conversationId: CONV_ID })
      } catch (e) {
        err = e
      }
      expect((err as ManualLearningError).code).toBe('no_agent')
    }, 30_000)
  })

  it('caps the pass at the most recent windows for an oversized thread', async () => {
    // window=2, maxWindows=2 → cap 4; 6 messages must collapse to the last 4.
    process.env.LEARN_MANUAL_WINDOW = '2'
    process.env.LEARN_MANUAL_MAX_WINDOWS = '2'
    await seedConversation({ assignee: `agent:${MERIGPT_AGENT_ID}`, channelConfig: {}, messageCount: 6 })

    const result = await svc.triggerLearning({ conversationId: CONV_ID })

    expect(result.messageCount).toBe(4)
    expect(result.windowCount).toBe(2)
    // The most-recent slice — message 6 is present, message 1 (oldest) is not.
    const allBodies = published.map((p) => (p.payload.signal.kind === 'manual' ? p.payload.signal.body : '')).join('\n')
    expect(allBodies).toContain('Message number 6')
    expect(allBodies).not.toContain('Message number 1 ')
  }, 30_000)

  it('enqueues even when the LEARN_AUTO_TRIAGE kill-switch is off', async () => {
    // The kill-switch gates only the automatic producers; the manual path must
    // always run regardless of it.
    delete process.env.LEARN_AUTO_TRIAGE
    await seedConversation({ assignee: `agent:${MERIGPT_AGENT_ID}`, channelConfig: {}, messageCount: 2 })

    const result = await svc.triggerLearning({ conversationId: CONV_ID })

    expect(result.windowCount).toBe(1)
    expect(published.length).toBe(1)
  }, 30_000)

  it('throws conversation_not_found for an unknown conversation', async () => {
    let err: unknown
    try {
      await svc.triggerLearning({ conversationId: 'does-not-exist', agentId: MERIGPT_AGENT_ID })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ManualLearningError)
    expect((err as ManualLearningError).code).toBe('conversation_not_found')
  }, 30_000)
})
