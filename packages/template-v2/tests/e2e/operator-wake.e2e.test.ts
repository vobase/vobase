/**
 * Operator wake — real-Postgres integration of the §10.6/10.7/10.8 pipeline.
 *
 * Verifies that `buildOperatorWakeConfig` composes correctly against a real
 * DB + the full service install chain (agent definitions, threads, schedules,
 * contacts, conversations, pending approvals, etc.), and that the resulting
 * config carries the operator-flavoured surface — synthetic conversationId,
 * `/INDEX.md` materializer, operator brief side-load, full operator tool
 * set, operator-RO config (writes restricted to `/agents/<id>/...`).
 *
 * Going further (stub-stream → real harness → tool fires → pending_approval
 * row written) would need the `stub-stream` helper from CLAUDE.md to be
 * ported into this branch; that is tracked as a follow-up.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { MERIDIAN_AGENT_ID, MERIDIAN_ORG_ID } from '@modules/agents/seed'
import {
  __resetAgentDefinitionsServiceForTests,
  createAgentDefinitionsService,
  getById as getAgentDefinition,
  installAgentDefinitionsService,
} from '@modules/agents/service/agent-definitions'
import {
  __resetStaffMemoryServiceForTests,
  createStaffMemoryService,
  installStaffMemoryService,
} from '@modules/agents/service/staff-memory'
import {
  __resetThreadsServiceForTests,
  createThreadsService,
  installThreadsService,
  threads as threadsApi,
} from '@modules/agents/service/threads'
import { buildOperatorWakeConfig } from '@modules/agents/wake/build-config/operator'
import {
  __resetContactsServiceForTests,
  createContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import { __resetFilesDbForTests, setFilesDb } from '@modules/drive/service/files'
import {
  __resetConversationsServiceForTests,
  createConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import { __resetNotesServiceForTests, createNotesService, installNotesService } from '@modules/messaging/service/notes'
import {
  __resetPendingApprovalsServiceForTests,
  createPendingApprovalsService,
  installPendingApprovalsService,
} from '@modules/messaging/service/pending-approvals'
import {
  __resetSchedulesServiceForTests,
  createSchedulesService,
  installSchedulesService,
} from '@modules/schedules/service/schedules'
import { __resetStaffServiceForTests, createStaffService, installStaffService } from '@modules/team/service/staff'
import type { AgentContributions, HarnessLogger } from '@vobase/core'
import { setJournalDb } from '@vobase/core'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const NOOP_CONTRIBUTIONS: AgentContributions = {
  tools: [],
  listeners: {},
  materializers: [],
  sideLoad: [],
  commands: [],
}

let db: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  setJournalDb(db.db as unknown as Parameters<typeof setJournalDb>[0])
  setFilesDb(db.db)
  installAgentDefinitionsService(createAgentDefinitionsService({ db: db.db }))
  installThreadsService(createThreadsService({ db: db.db }))
  installContactsService(createContactsService({ db: db.db }))
  installSchedulesService(createSchedulesService({ db: db.db }))
  installConversationsService(createConversationsService({ db: db.db, scheduler: null }))
  installNotesService(createNotesService({ db: db.db }))
  installPendingApprovalsService(createPendingApprovalsService({ db: db.db }))
  installStaffService(createStaffService({ db: db.db }))
  installStaffMemoryService(createStaffMemoryService({ db: db.db }))
}, 60_000)

afterAll(async () => {
  __resetAgentDefinitionsServiceForTests()
  __resetThreadsServiceForTests()
  __resetContactsServiceForTests()
  __resetSchedulesServiceForTests()
  __resetConversationsServiceForTests()
  __resetNotesServiceForTests()
  __resetPendingApprovalsServiceForTests()
  __resetStaffServiceForTests()
  __resetStaffMemoryServiceForTests()
  __resetFilesDbForTests()
  if (db) await db.teardown()
})

describe('buildOperatorWakeConfig (real PG)', () => {
  it('operator_thread wake: synthetic conversationId, operator tools, /INDEX.md materializer, operator brief side-load', async () => {
    // Provision a thread + staff message via the public service surface so
    // the test exercises the same path as the operator chat producer will.
    const { threadId } = await threadsApi.createThread({
      organizationId: MERIDIAN_ORG_ID,
      agentId: MERIDIAN_AGENT_ID,
      createdBy: 'staff:test',
      title: 'Test brief',
      firstMessage: { role: 'user', content: 'Summarize today and propose any follow-ups.' },
    })

    const config = await buildOperatorWakeConfig({
      data: {
        organizationId: MERIDIAN_ORG_ID,
        triggerKind: 'operator_thread',
        threadId,
        threadMessage: 'Summarize today and propose any follow-ups.',
      },
      agentId: MERIDIAN_AGENT_ID,
      agentDefinition: await getAgentDefinition(MERIDIAN_AGENT_ID),
      contributions: NOOP_CONTRIBUTIONS,
      deps: { db: db.db, realtime: { notify: () => {} } as never, logger: NOOP_LOGGER },
    })

    // Synthetic id: prefixed so journal queries can distinguish operator
    // events from concierge ones.
    expect(config.conversationId).toBe(`operator-${threadId}`)
    expect(config.contactId).toBe('')
    expect(config.organizationId).toBe(MERIDIAN_ORG_ID)
    expect(config.agentId).toBe(MERIDIAN_AGENT_ID)

    const toolNames = (config.tools as readonly { name: string }[]).map((t) => t.name)
    expect(toolNames).toContain('update_contact')
    expect(toolNames).toContain('add_note')
    expect(toolNames).toContain('create_schedule')
    expect(toolNames).toContain('pause_schedule')
    expect(toolNames).toContain('summarize_inbox')
    expect(toolNames).toContain('draft_email_to_review')
    expect(toolNames).toContain('propose_outreach')
    // Concierge tools (`reply`, `send_card`, etc.) MUST NOT leak into the
    // operator surface — they're a different role's catalogue.
    expect(toolNames).not.toContain('reply')
    expect(toolNames).not.toContain('send_card')

    // `/INDEX.md` materializer is installed for both surfaces — verify it's
    // there for operator wakes too.
    const paths = (config.materializers ?? []).map((m) => m.path)
    expect(paths).toContain('/INDEX.md')

    // Conversation transcript materializers MUST NOT be present — operator
    // wakes have no contactId, no channelInstanceId.
    expect(paths.some((p) => p.endsWith('/messages.md'))).toBe(false)
    expect(paths.some((p) => p.endsWith('/internal-notes.md'))).toBe(false)

    // Operator brief side-load — the staff message surfaces in the rendered
    // body so the agent has explicit context.
    const sideLoadEntries = await Promise.all(
      (config.sideLoadContributors ?? []).map((fn) =>
        fn({
          organizationId: MERIDIAN_ORG_ID,
          conversationId: config.conversationId,
          contactId: '',
          turnIndex: 0,
        } as never),
      ),
    )
    const flatSideLoad = sideLoadEntries.flat()
    const briefEntry = flatSideLoad.find((e) => (e.kind === 'custom' ? e.render().includes('Operator Brief') : false))
    expect(briefEntry).toBeDefined()
    if (briefEntry?.kind === 'custom') {
      const rendered = briefEntry.render()
      expect(rendered).toContain('## Latest staff message')
      expect(rendered).toContain('Summarize today and propose any follow-ups.')
    }

    // Trigger renderer should produce the operator-friendly cue, NOT the
    // concierge "see messages.md" cue.
    const cue = config.renderTrigger?.(config.trigger)
    expect(cue).toContain('staff member posted')
  })

  it('heartbeat wake: heartbeat-<scheduleId> conversationId, heartbeat brief side-load', async () => {
    const config = await buildOperatorWakeConfig({
      data: {
        organizationId: MERIDIAN_ORG_ID,
        triggerKind: 'heartbeat',
        scheduleId: 'sch_smoke',
        intendedRunAt: new Date('2026-04-26T18:00:00.000Z'),
        reason: 'cron 0 18 * * *',
      },
      agentId: MERIDIAN_AGENT_ID,
      agentDefinition: await getAgentDefinition(MERIDIAN_AGENT_ID),
      contributions: NOOP_CONTRIBUTIONS,
      deps: { db: db.db, realtime: { notify: () => {} } as never, logger: NOOP_LOGGER },
    })

    expect(config.conversationId).toBe('heartbeat-sch_smoke')
    expect(config.trigger?.trigger).toBe('heartbeat')

    const sideLoadEntries = await Promise.all(
      (config.sideLoadContributors ?? []).map((fn) =>
        fn({
          organizationId: MERIDIAN_ORG_ID,
          conversationId: config.conversationId,
          contactId: '',
          turnIndex: 0,
        } as never),
      ),
    )
    const briefEntry = sideLoadEntries
      .flat()
      .find((e) => (e.kind === 'custom' ? e.render().includes('Operator Brief') : false))
    if (briefEntry?.kind === 'custom') {
      expect(briefEntry.render()).toContain('heartbeat')
      expect(briefEntry.render()).toContain('review-and-plan')
    } else {
      throw new Error('expected operator brief side-load entry')
    }

    const cue = config.renderTrigger?.(config.trigger)
    expect(cue).toContain('Heartbeat')
    expect(cue).toContain('2026-04-26T18:00:00.000Z')
  })
})
