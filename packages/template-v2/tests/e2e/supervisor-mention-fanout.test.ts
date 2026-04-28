/**
 * Supervisor mention fan-out — Slice 1 of trigger-driven-capabilities.
 *
 * Boots the messaging notes service against a real Postgres seed with a
 * captured `SupervisorScheduler` so each enqueue call (assignee self-wake +
 * peer wakes) is observable as a payload.
 *
 * Mirrors the install pattern from `tests/e2e/operator-wake.e2e.test.ts`:
 *   - `connectTestDb` + `resetAndSeedDb` for a clean schema.
 *   - direct service installs — bypassing the runtime job queue keeps the
 *     test focused on the fan-out shape (the supervisor handler itself is
 *     covered separately by `buildWakeConfig` with `triggerOverride`).
 *
 * Acceptance scenarios — PRD US-203 (a)–(e):
 *   (a) `@Sentinel` in Meridian-assigned conv → 2 enqueues
 *   (b) self-mention `@Meridian` in Meridian-assigned conv → 1 enqueue
 *   (c) `@Sentinel @Atlas` in Meridian-assigned conv → 3 enqueues
 *   (d) `@Meridian` in Sentinel-assigned conv → 2 enqueues; Meridian boots
 *       via conversation-lane builder with `reply` + `send_card` available
 *   (e) Agent-authored note `"@Atlas thoughts?"` → 0 enqueues
 *
 * Plus a frozen-snapshot byte-stability assertion for systemHash across two
 * consecutive supervisor wakes for the same (conversationId, mentionedAgentId)
 * pair (Risk #2 mitigation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { agentDefinitions } from '@modules/agents/schema'
import { MERIDIAN_AGENT_ID, MERIDIAN_ORG_ID, SENTINEL_AGENT_ID } from '@modules/agents/seed'
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
import { conversationTools } from '@modules/agents/tools/conversation'
import { buildWakeConfig } from '@modules/agents/wake/build-config'
import {
  __resetContactsServiceForTests,
  createContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import { __resetFilesDbForTests, setFilesDb } from '@modules/drive/service/files'
import { conversations as conversationsTable } from '@modules/messaging/schema'
import {
  __resetAgentMentionsServiceForTests,
  createAgentMentionsService,
  installAgentMentionsService,
} from '@modules/messaging/service/agent-mentions'
import {
  __resetConversationsServiceForTests,
  createConversationsService,
  get as getConversation,
  installConversationsService,
  reassign,
} from '@modules/messaging/service/conversations'
import {
  __resetMessagesServiceForTests,
  createMessagesService,
  installMessagesService,
} from '@modules/messaging/service/messages'
import {
  __resetNotesServiceForTests,
  addNote,
  buildSupervisorSingletonKey,
  type ConversationsReader,
  createNotesService,
  installNotesService,
  listNotes,
  type SupervisorScheduler,
} from '@modules/messaging/service/notes'
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
import type { AgentContributions, AgentTool, HarnessLogger } from '@vobase/core'
import { setJournalDb } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const NOOP_REALTIME = { notify: () => {}, subscribe: () => () => {} }

const ATLAS_AGENT_ID = 'agt-test-atlas-fan'
const STAFF_USER_ID = 'usr-staff-test'

interface CapturedEnqueue {
  conversationId: string
  noteId: string
  authorUserId: string
  organizationId: string
  mentionedAgentId?: string
  assigneeAgentId?: string
  /** Singleton key the production scheduler would generate from these args. */
  singletonKey: string
}

let db: TestDbHandle
let captured: CapturedEnqueue[] = []
let priyaConvId: string

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  setJournalDb(db.db as unknown as Parameters<typeof setJournalDb>[0])

  // Seed an extra Atlas agent so the @Atlas peer-wake case (c) and the
  // ping-pong case (e) can target a real, enabled agent definition.
  await (db.db as unknown as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
    .insert(agentDefinitions)
    .values({
      id: ATLAS_AGENT_ID,
      organizationId: MERIDIAN_ORG_ID,
      name: 'Atlas',
      enabled: true,
    })

  // Resolve a seed conversation we know is assigned to Meridian (Priya
  // refund thread is the canonical concierge fixture).
  const convRows = (await db.db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.assignee, `agent:${MERIDIAN_AGENT_ID}`))
    .limit(1)) as unknown[]
  if (convRows.length === 0) {
    throw new Error('test setup: no conversation assigned to Meridian was seeded')
  }
  priyaConvId = (convRows[0] as { id: string }).id

  // Wire the service surface — captured scheduler instead of jobs.send.
  installAgentDefinitionsService(createAgentDefinitionsService({ db: db.db }))
  installMessagesService(createMessagesService({ db: db.db }))
  installConversationsService(createConversationsService({ db: db.db, scheduler: null }))
  installAgentMentionsService(createAgentMentionsService({ db: db.db }))
  // buildWakeConfig dependencies — drive files, contacts profile reader, staff
  // memory (for the per-staff side-load). Mirrors operator-wake.e2e.test.ts.
  setFilesDb(db.db)
  installContactsService(createContactsService({ db: db.db, realtime: NOOP_REALTIME }))
  installStaffMemoryService(createStaffMemoryService({ db: db.db, realtime: NOOP_REALTIME }))
  installSchedulesService(createSchedulesService({ db: db.db }))
  installStaffService(createStaffService({ db: db.db }))
  installPendingApprovalsService(createPendingApprovalsService({ db: db.db }))

  const scheduler: SupervisorScheduler = {
    // biome-ignore lint/suspicious/useAwait: capture scheduler matches async contract
    enqueueSupervisor: async (opts) => {
      captured.push({
        conversationId: opts.conversationId,
        noteId: opts.noteId,
        authorUserId: opts.authorUserId,
        organizationId: opts.organizationId,
        mentionedAgentId: opts.mentionedAgentId,
        assigneeAgentId: opts.assigneeAgentId,
        singletonKey: buildSupervisorSingletonKey({
          conversationId: opts.conversationId,
          noteId: opts.noteId,
          mentionedAgentId: opts.mentionedAgentId,
        }),
      })
    },
  }

  const conversationsReader: ConversationsReader = {
    getAssigneeAgentId: async (conversationId) => {
      const conv = await getConversation(conversationId)
      return conv.assignee.startsWith('agent:') ? conv.assignee.slice('agent:'.length) : null
    },
  }

  installNotesService(
    createNotesService({
      db: db.db,
      scheduler,
      conversations: conversationsReader,
    }),
  )
}, 60_000)

afterAll(async () => {
  __resetAgentDefinitionsServiceForTests()
  __resetMessagesServiceForTests()
  __resetConversationsServiceForTests()
  __resetAgentMentionsServiceForTests()
  __resetNotesServiceForTests()
  __resetContactsServiceForTests()
  __resetStaffMemoryServiceForTests()
  __resetFilesDbForTests()
  __resetSchedulesServiceForTests()
  __resetStaffServiceForTests()
  __resetPendingApprovalsServiceForTests()

  if (db) {
    const handle = db.db as unknown as {
      delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> }
    }
    await handle.delete(agentDefinitions).where(eq(agentDefinitions.id, ATLAS_AGENT_ID))
    await db.teardown()
  }
})

async function waitForCaptures(min: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (captured.length >= min) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('supervisor mention fan-out', () => {
  it('(a) @Sentinel in Meridian-assigned conv → assignee self-wake (Meridian) + Sentinel peer wake', async () => {
    captured = []

    const note = await addNote({
      organizationId: MERIDIAN_ORG_ID,
      conversationId: priyaConvId,
      author: { kind: 'staff', id: STAFF_USER_ID },
      body: '@Sentinel can you take a look?',
      mentions: [`agent:${SENTINEL_AGENT_ID}`],
    })

    await waitForCaptures(2)
    expect(captured.length).toBe(2)

    const selfWake = captured.find((c) => !c.mentionedAgentId)
    expect(selfWake).toBeDefined()
    expect(selfWake?.assigneeAgentId).toBe(MERIDIAN_AGENT_ID)
    expect(selfWake?.singletonKey).toBe(buildSupervisorSingletonKey({ conversationId: priyaConvId, noteId: note.id }))

    const peerWake = captured.find((c) => c.mentionedAgentId === SENTINEL_AGENT_ID)
    expect(peerWake).toBeDefined()
    expect(peerWake?.assigneeAgentId).toBe(MERIDIAN_AGENT_ID)
    expect(peerWake?.singletonKey).toBe(
      buildSupervisorSingletonKey({
        conversationId: priyaConvId,
        noteId: note.id,
        mentionedAgentId: SENTINEL_AGENT_ID,
      }),
    )
  })

  it('(b) self-mention @Meridian in Meridian-assigned conv → exactly ONE supervisor wake (assignee, no mentionedAgentId)', async () => {
    captured = []

    const note = await addNote({
      organizationId: MERIDIAN_ORG_ID,
      conversationId: priyaConvId,
      author: { kind: 'staff', id: STAFF_USER_ID },
      body: '@Meridian please double-check',
      mentions: [`agent:${MERIDIAN_AGENT_ID}`],
    })

    await waitForCaptures(1)
    expect(captured.length).toBe(1)
    expect(captured[0]?.mentionedAgentId).toBeUndefined()
    expect(captured[0]?.assigneeAgentId).toBe(MERIDIAN_AGENT_ID)
    expect(captured[0]?.singletonKey).toBe(
      buildSupervisorSingletonKey({ conversationId: priyaConvId, noteId: note.id }),
    )
  })

  it('(c) @Sentinel @Atlas in Meridian-assigned conv → 3 enqueues with distinct singletonKeys', async () => {
    captured = []

    const note = await addNote({
      organizationId: MERIDIAN_ORG_ID,
      conversationId: priyaConvId,
      author: { kind: 'staff', id: STAFF_USER_ID },
      body: '@Sentinel @Atlas need both eyes on this',
      mentions: [`agent:${SENTINEL_AGENT_ID}`, `agent:${ATLAS_AGENT_ID}`],
    })

    await waitForCaptures(3)
    expect(captured.length).toBe(3)

    const singletonKeys = captured.map((c) => c.singletonKey)
    const uniqueKeys = new Set(singletonKeys)
    expect(uniqueKeys.size).toBe(3)
    expect(uniqueKeys.has(buildSupervisorSingletonKey({ conversationId: priyaConvId, noteId: note.id }))).toBe(true)
    expect(
      uniqueKeys.has(
        buildSupervisorSingletonKey({
          conversationId: priyaConvId,
          noteId: note.id,
          mentionedAgentId: SENTINEL_AGENT_ID,
        }),
      ),
    ).toBe(true)
    expect(
      uniqueKeys.has(
        buildSupervisorSingletonKey({
          conversationId: priyaConvId,
          noteId: note.id,
          mentionedAgentId: ATLAS_AGENT_ID,
        }),
      ),
    ).toBe(true)
  })

  it('(d) Sentinel-assigned conv with @Meridian → Meridian peer wake; conversation-lane builder yields reply + send_card', async () => {
    captured = []

    // Reassign Priya conv to Sentinel, fire the peer-wake into Meridian.
    await reassign(priyaConvId, `agent:${SENTINEL_AGENT_ID}`, STAFF_USER_ID, 'test reassign')
    try {
      const note = await addNote({
        organizationId: MERIDIAN_ORG_ID,
        conversationId: priyaConvId,
        author: { kind: 'staff', id: STAFF_USER_ID },
        body: '@Meridian thoughts on the refund?',
        mentions: [`agent:${MERIDIAN_AGENT_ID}`],
      })

      await waitForCaptures(2)
      expect(captured.length).toBe(2)

      const sentinelSelfWake = captured.find((c) => !c.mentionedAgentId)
      expect(sentinelSelfWake?.assigneeAgentId).toBe(SENTINEL_AGENT_ID)

      const meridianPeerWake = captured.find((c) => c.mentionedAgentId === MERIDIAN_AGENT_ID)
      expect(meridianPeerWake).toBeDefined()
      expect(meridianPeerWake?.assigneeAgentId).toBe(SENTINEL_AGENT_ID)

      // Build the wake config via the same code path the supervisor handler
      // would take, then assert Meridian boots with concierge tools.
      const conv = await getConversation(priyaConvId)
      const meridianDef = await getAgentDefinition(MERIDIAN_AGENT_ID)
      const contributions: AgentContributions = {
        tools: [],
        listeners: {},
        materializers: [],
        sideLoad: [],
        commands: [],
      }
      const config = await buildWakeConfig({
        data: {
          organizationId: MERIDIAN_ORG_ID,
          conversationId: priyaConvId,
          messageId: '',
          contactId: conv.contactId,
        },
        conv,
        agentId: MERIDIAN_AGENT_ID,
        agentDefinition: meridianDef,
        contributions,
        deps: { db: db.db, realtime: NOOP_REALTIME, logger: NOOP_LOGGER },
        triggerOverride: {
          trigger: 'supervisor',
          conversationId: priyaConvId,
          noteId: note.id,
          authorUserId: STAFF_USER_ID,
          mentionedAgentId: MERIDIAN_AGENT_ID,
        },
      })

      const toolNames = (config.tools as readonly AgentTool[]).map((t) => t.name)
      expect(toolNames).toContain('reply')
      expect(toolNames).toContain('send_card')

      // Trigger renderer recognises the mentionedAgentId variant.
      const cue = config.renderTrigger?.(config.trigger)
      expect(cue).toContain('@-mentioned you in an internal note')

      // Sanity: the concierge tool surface is what we expect (`reply`,
      // `send_card`, `send_file`, `book_slot`).
      const conciergeNames = conversationTools.map((t) => t.name)
      for (const n of conciergeNames) expect(toolNames).toContain(n)
    } finally {
      // Restore the assignee for downstream tests.
      await reassign(priyaConvId, `agent:${MERIDIAN_AGENT_ID}`, STAFF_USER_ID, 'test cleanup')
    }
  })

  it('(e) agent-authored note "@Atlas thoughts?" → ZERO enqueues but the note row still inserts', async () => {
    captured = []

    const before = await listNotes(priyaConvId)
    await addNote({
      organizationId: MERIDIAN_ORG_ID,
      conversationId: priyaConvId,
      author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
      body: '@Atlas thoughts?',
      mentions: [`agent:${ATLAS_AGENT_ID}`],
    })

    // Allow the microtask queue to drain before asserting "no" enqueues.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(captured.length).toBe(0)

    const after = await listNotes(priyaConvId)
    expect(after.length).toBe(before.length + 1)
    expect(after[after.length - 1]?.authorType).toBe('agent')
    expect(after[after.length - 1]?.body).toBe('@Atlas thoughts?')
  })

  it('frozen-snapshot byte-stability — same supervisor trigger yields identical systemHash twice', async () => {
    const conv = await getConversation(priyaConvId)
    const meridianDef = await getAgentDefinition(MERIDIAN_AGENT_ID)
    const contributions: AgentContributions = {
      tools: [],
      listeners: {},
      materializers: [],
      sideLoad: [],
      commands: [],
    }
    const triggerOverride = {
      trigger: 'supervisor' as const,
      conversationId: priyaConvId,
      noteId: 'note-frozen-fixture',
      authorUserId: STAFF_USER_ID,
      mentionedAgentId: MERIDIAN_AGENT_ID,
    }

    const buildOnce = () =>
      buildWakeConfig({
        data: {
          organizationId: MERIDIAN_ORG_ID,
          conversationId: priyaConvId,
          messageId: '',
          contactId: conv.contactId,
        },
        conv,
        agentId: MERIDIAN_AGENT_ID,
        agentDefinition: meridianDef,
        contributions,
        deps: { db: db.db, realtime: NOOP_REALTIME, logger: NOOP_LOGGER },
        triggerOverride,
      })

    const a = await buildOnce()
    const b = await buildOnce()
    expect(a.systemHash).toBe(b.systemHash)
  })
})
