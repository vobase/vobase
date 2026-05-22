/**
 * Operator wake — real-Postgres integration of the §10.6/10.7/10.8 pipeline.
 *
 * Verifies that `standaloneWakeConfig` composes correctly against a real
 * DB + the full service install chain (agent definitions, threads, schedules,
 * contacts, conversations, pending approvals, etc.), and that the resulting
 * config carries the standalone-lane surface — synthetic conversationId,
 * `/INDEX.md` materializer, standalone brief side-load, full standalone tool
 * set, standalone-RO config (writes restricted to `/agents/<id>/...`).
 *
 * Going further (stub-stream → real harness → tool fires → pending_approval
 * row written) would need the `stub-stream` helper from CLAUDE.md to be
 * ported into this branch; that is tracked as a follow-up.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import {
  __resetAgentDefinitionsServiceForTests,
  createAgentDefinitionsService,
  getById as getAgentDefinition,
  installAgentDefinitionsService,
} from '@modules/agents/service/agent-definitions'
import { __resetCliRegistryForTests, setCliRegistry } from '@modules/agents/service/cli-registry'
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
import { automationsTools } from '@modules/automations/agent'
import {
  __resetAutomationsServiceForTests,
  createAutomationsService,
  installAutomationsService,
} from '@modules/automations/service/automations'
import {
  __resetChannelInstancesServiceForTests,
  createChannelInstancesService,
  installChannelInstancesService,
} from '@modules/channels/service/instances'
import { contactsTools } from '@modules/contacts/agent'
import {
  __resetContactsServiceForTests,
  createContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import { __resetFilesDbForTests, setFilesDb } from '@modules/drive/service/files'
import { messagingTools } from '@modules/messaging/agent'
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
import { __resetStaffServiceForTests, createStaffService, installStaffService } from '@modules/team/service/staff'
import type { AgentContributions, HarnessLogger } from '@vobase/core'
import { CliVerbRegistry, setJournalDb } from '@vobase/core'

import { standaloneWakeConfig } from '~/wake/standalone'
import { getSeededOrgId } from '../helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

// Tools live on the owning modules now (PR2 of the canonical-shape refactor).
// The wake-handler consumer fans `collectAgentContributions(modules)` into the
// build configs at boot; the e2e test bypasses module init, so we splice the
// owning-module tools in here directly.
const NOOP_CONTRIBUTIONS: AgentContributions = {
  tools: [...messagingTools, ...contactsTools, ...automationsTools],
  listeners: {},
  materializers: [],
  sideLoad: [],
  agentsMd: [],
  roHints: [],
}

let db: TestDbHandle

const NOOP_REALTIME = { notify: () => {}, subscribe: () => () => {} }
const NOOP_JOBS = { send: async (_name: string, _data: unknown) => 'noop', cancel: async (_id: string) => {} }

let organizationId: string

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  organizationId = await getSeededOrgId(db.db)
  setJournalDb(db.db as unknown as Parameters<typeof setJournalDb>[0])
  setFilesDb(db.db)
  setCliRegistry(new CliVerbRegistry())
  installAgentDefinitionsService(createAgentDefinitionsService({ db: db.db, realtime: NOOP_REALTIME }))
  installThreadsService(createThreadsService({ db: db.db }))
  installContactsService(createContactsService({ db: db.db, realtime: NOOP_REALTIME }))
  installAutomationsService(createAutomationsService({ db: db.db }))
  installConversationsService(createConversationsService({ db: db.db, scheduler: null }))
  installNotesService(createNotesService({ db: db.db }))
  installPendingApprovalsService(createPendingApprovalsService({ db: db.db }))
  installStaffService(createStaffService({ db: db.db, realtime: NOOP_REALTIME }))
  installStaffMemoryService(createStaffMemoryService({ db: db.db, realtime: NOOP_REALTIME }))
  installChannelInstancesService(createChannelInstancesService({ db: db.db }))
}, 60_000)

afterAll(async () => {
  __resetAgentDefinitionsServiceForTests()
  __resetCliRegistryForTests()
  __resetThreadsServiceForTests()
  __resetContactsServiceForTests()
  __resetAutomationsServiceForTests()
  __resetConversationsServiceForTests()
  __resetNotesServiceForTests()
  __resetPendingApprovalsServiceForTests()
  __resetStaffServiceForTests()
  __resetStaffMemoryServiceForTests()
  __resetChannelInstancesServiceForTests()
  __resetFilesDbForTests()
  if (db) await db.teardown()
})

describe('standaloneWakeConfig (real PG)', () => {
  it('operator_thread wake: synthetic conversationId, operator tools, /INDEX.md materializer, operator brief side-load', async () => {
    // Provision a thread + staff message via the public service surface so
    // the test exercises the same path as the operator chat producer will.
    const { threadId } = await threadsApi.createThread({
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      createdBy: 'staff:test',
      title: 'Test brief',
      firstMessage: { role: 'user', content: 'Summarize today and propose any follow-ups.' },
    })

    const config = await standaloneWakeConfig({
      data: {
        organizationId: organizationId,
        triggerKind: 'operator_thread',
        threadId,
        threadMessage: 'Summarize today and propose any follow-ups.',
      },
      agentId: MERIGPT_AGENT_ID,
      agentDefinition: await getAgentDefinition(MERIGPT_AGENT_ID),
      contributions: NOOP_CONTRIBUTIONS,
      deps: { db: db.db, realtime: { notify: () => {} } as never, logger: NOOP_LOGGER, jobs: NOOP_JOBS },
    })

    // Synthetic id: prefixed so journal queries can distinguish standalone-
    // lane events from conversation-lane ones.
    expect(config.conversationId).toBe(`operator-${threadId}`)
    expect(config.contactId).toBe('')
    expect(config.organizationId).toBe(organizationId)
    expect(config.agentId).toBe(MERIGPT_AGENT_ID)

    const toolNames = (config.tools as readonly { name: string }[]).map((t) => t.name)
    expect(toolNames).toContain('update_contact')
    expect(toolNames).toContain('add_note')
    expect(toolNames).toContain('create_schedule')
    expect(toolNames).toContain('pause_schedule')
    expect(toolNames).toContain('summarize_inbox')
    expect(toolNames).toContain('draft_email_to_review')
    expect(toolNames).toContain('propose_outreach')
    // Conversation-lane tools (`reply_contact`, `send_card`, etc.) MUST NOT leak
    // into the standalone surface — they're a different lane's catalogue.
    expect(toolNames).not.toContain('reply_contact')
    expect(toolNames).not.toContain('send_card')

    // `/INDEX.md` materializer is installed for both surfaces — verify it's
    // there for operator wakes too.
    const paths = (config.materializers ?? []).map((m) => m.path)
    expect(paths).toContain('/INDEX.md')

    // Conversation timeline materializer MUST NOT be present — operator
    // wakes have no contactId, no channelInstanceId.
    expect(paths.some((p) => p.endsWith('/CONVERSATION.md'))).toBe(false)

    // Operator brief side-load — framing only, message body has moved to the
    // user-turn render text (see the renderTrigger assertion below).
    const sideLoadEntries = await Promise.all(
      (config.sideLoadContributors ?? []).map((fn) =>
        fn({
          organizationId: organizationId,
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
      // The brief carries the operator-chat framing + per-wake instructions —
      // it is side-loaded onto the current turn only, so replayed history
      // stays a clean chat.
      expect(rendered).toContain('operator thread')
      expect(rendered).toContain('LAST message')
      // Framing only; the message body itself must NOT be duplicated here.
      expect(rendered).not.toContain('## Latest staff message')
    }

    // The user-turn render is the BARE staff message — no imperatives, no
    // framing. It is persisted to `agent_messages` and replayed as history on
    // later wakes, so it must read as a plain chat line; imperatives in every
    // persisted turn made the agent answer an older turn (the off-by-one bug).
    const renderedTrigger = config.renderTrigger?.(config.trigger)
    expect(renderedTrigger).toBe('Summarize today and propose any follow-ups.')
  })

  it('heartbeat wake: heartbeat-<scheduleId> conversationId, heartbeat brief side-load', async () => {
    const config = await standaloneWakeConfig({
      data: {
        organizationId: organizationId,
        triggerKind: 'heartbeat',
        scheduleId: 'sch_smoke',
        intendedRunAt: new Date('2026-04-26T18:00:00.000Z'),
        reason: 'cron 0 18 * * *',
      },
      agentId: MERIGPT_AGENT_ID,
      agentDefinition: await getAgentDefinition(MERIGPT_AGENT_ID),
      contributions: NOOP_CONTRIBUTIONS,
      deps: { db: db.db, realtime: { notify: () => {} } as never, logger: NOOP_LOGGER, jobs: NOOP_JOBS },
    })

    expect(config.conversationId).toBe('heartbeat-sch_smoke')
    expect(config.trigger?.trigger).toBe('heartbeat')

    const sideLoadEntries = await Promise.all(
      (config.sideLoadContributors ?? []).map((fn) =>
        fn({
          organizationId: organizationId,
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
