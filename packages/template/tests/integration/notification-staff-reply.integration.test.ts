/**
 * Integration: forwarded staff WhatsApp replies on the managed notification
 * channel are dispatched by `dispatchStaffReply`, never persisted as a
 * customer message.
 *
 * The notification number is a first-class managed `whatsapp_notif` channel.
 * When a staff member replies to an agent ping over WhatsApp, Meta forwards a
 * Meta-shaped inbound to `POST /api/channels/managed/inbound/:id`, which calls
 * `dispatchStaffReply`. This must resolve to a staff-reply outcome — an
 * internal note or an operator thread — and must NOT open a customer
 * conversation.
 *
 * Two branches are covered against real Postgres:
 *   - operator-thread — a staff member with no live pending ping: the reply
 *     opens (or appends to) an operator thread for the org's default operator
 *     agent.
 *   - ask-staff-answer — a staff member with a live `pending_staff_pings` row:
 *     the reply becomes a staff-authored internal note mentioning the asking
 *     agent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { authUser } from '@auth/schema'
import { operatorThreadMessages, operatorThreads } from '@modules/agents/schema'
import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import { __resetAgentsStateForTests, createAgentsState, installAgentsState } from '@modules/agents/service/state'
import {
  __resetThreadsServiceForTests,
  createThreadsService,
  installThreadsService,
} from '@modules/agents/service/threads'
import { dispatchStaffReply, type MetaInbound } from '@modules/channels/handlers/staff-reply-dispatch'
import { channelInstances } from '@modules/channels/schema'
import { contacts } from '@modules/contacts/schema'
import { conversations, internalNotes, messages } from '@modules/messaging/schema'
import { __resetNotesServiceForTests, createNotesService, installNotesService } from '@modules/messaging/service/notes'
import {
  __resetOrgSettingsServiceForTests,
  createOrgSettingsService,
  installOrgSettingsService,
} from '@modules/settings/service/org-settings'
import { pendingStaffPings, staffProfiles } from '@modules/team/schema'
import {
  __resetPendingStaffPingServiceForTests,
  createPendingStaffPingService,
  installPendingStaffPingService,
} from '@modules/team/service/pending-staff-pings'
import { and, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { getSeededOrgId } from '../helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

const STAFF_OPERATOR_USER = 'usr-staffreply-operator'
const STAFF_OPERATOR_PHONE = '+6590000001'
const STAFF_PING_USER = 'usr-staffreply-ping'
const STAFF_PING_PHONE = '+6590000002'
const NOTIF_INSTANCE_ID = 'ci-staffreply-notif'
const PING_CONVERSATION_ID = 'conv-staffreply-ping'

let handle: TestDbHandle
let db: ScopedDb
let organizationId: string

/** Builds a Meta-shaped inbound carrying a single forwarded staff text reply. */
function makeInbound(fromPhoneE164: string, body: string): MetaInbound {
  // Meta's `wa_id` has no leading `+`; the dispatcher tolerates both forms.
  const from = fromPhoneE164.replace(/^\+/, '')
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: 'plat-staffreply' },
              messages: [{ from, type: 'text', id: `wamid.${from}.${Date.now()}`, text: { body } }],
            },
          },
        ],
      },
    ],
  }
}

beforeAll(async () => {
  await resetAndSeedDb()
  handle = connectTestDb()
  db = handle.db as unknown as ScopedDb
  organizationId = await getSeededOrgId(handle.db)

  installOrgSettingsService(createOrgSettingsService({ db }))
  installAgentsState(createAgentsState({ jobs: { send: async () => 'noop-job' } }))
  installThreadsService(createThreadsService({ db }))
  installNotesService(createNotesService({ db }))
  installPendingStaffPingService(createPendingStaffPingService({ db }))

  // Managed notification channel — the `whatsapp_notif` instance that forwards
  // staff replies to the dispatcher.
  await handle.db.insert(channelInstances).values({
    id: NOTIF_INSTANCE_ID,
    organizationId,
    channel: 'whatsapp_notif',
    role: 'staff',
    config: { mode: 'managed', kind: 'notification', organizationId, platformChannelId: 'plat-staffreply' },
    status: 'active',
  })

  // Two staff members, each with a verified phone on the better-auth `user`
  // row and a matching `staff_profiles` row.
  await handle.db.insert(authUser).values([
    {
      id: STAFF_OPERATOR_USER,
      name: 'Olivia Operator',
      email: 'olivia.operator@staffreply.test',
      emailVerified: true,
      phoneNumber: STAFF_OPERATOR_PHONE,
      phoneNumberVerified: true,
    },
    {
      id: STAFF_PING_USER,
      name: 'Patrick Pinged',
      email: 'patrick.pinged@staffreply.test',
      emailVerified: true,
      phoneNumber: STAFF_PING_PHONE,
      phoneNumberVerified: true,
    },
  ])
  await handle.db.insert(staffProfiles).values([
    { userId: STAFF_OPERATOR_USER, organizationId, displayName: 'Olivia Operator' },
    { userId: STAFF_PING_USER, organizationId, displayName: 'Patrick Pinged' },
  ])

  // A conversation the pending ping points at — `internal_notes` has an FK to
  // `conversations.id`, so the ask-staff-answer note needs a real row.
  // `conversations.contact_id` carries a cross-schema FK to `contacts`.
  await handle.db.insert(contacts).values({ id: 'contact-staffreply', organizationId, displayName: 'Test Contact' })
  await handle.db.insert(conversations).values({
    id: PING_CONVERSATION_ID,
    organizationId,
    contactId: 'contact-staffreply',
    channelInstanceId: NOTIF_INSTANCE_ID,
    status: 'active',
    assignee: `agent:${MERIGPT_AGENT_ID}`,
  })
}, 60_000)

afterAll(async () => {
  __resetOrgSettingsServiceForTests()
  __resetAgentsStateForTests()
  __resetThreadsServiceForTests()
  __resetNotesServiceForTests()
  __resetPendingStaffPingServiceForTests()
  if (handle) await handle.teardown()
})

describe('dispatchStaffReply — forwarded staff replies on the managed notification channel', () => {
  it('operator-thread branch: a staff member with no live ping opens an operator thread, no customer message', async () => {
    const result = await dispatchStaffReply({
      db,
      organizationId,
      payload: makeInbound(STAFF_OPERATOR_PHONE, 'Following up on the open tickets from this morning.'),
    })

    expect(result.branch).toBe('operator_thread')
    expect(result.threadId).toBeDefined()
    expect(result.agentId).toBe(MERIGPT_AGENT_ID)

    // An operator thread + first message was written, created by this staff member.
    const [thread] = await handle.db
      .select({ id: operatorThreads.id, createdBy: operatorThreads.createdBy })
      .from(operatorThreads)
      .where(eq(operatorThreads.id, result.threadId ?? ''))
      .limit(1)
    expect(thread?.createdBy).toBe(STAFF_OPERATOR_USER)

    const threadMessages = await handle.db
      .select({ content: operatorThreadMessages.content })
      .from(operatorThreadMessages)
      .where(eq(operatorThreadMessages.threadId, result.threadId ?? ''))
    expect(threadMessages.map((m) => m.content)).toContain('Following up on the open tickets from this morning.')

    // It must NOT have created a customer conversation or message for the
    // staff member's phone.
    const customerMessages = await handle.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(conversations.channelInstanceId, NOTIF_INSTANCE_ID))
    expect(customerMessages).toHaveLength(0)
  })

  it('ask-staff-answer branch: a staff member with a live ping replies into an internal note mentioning the asking agent', async () => {
    // Seed a single live pending ping for this staff member.
    await handle.db.insert(pendingStaffPings).values({
      organizationId,
      conversationId: PING_CONVERSATION_ID,
      staffUserId: STAFF_PING_USER,
      askingAgentId: MERIGPT_AGENT_ID,
      originalNoteId: 'note-staffreply-origin',
      kind: 'mention',
    })

    const result = await dispatchStaffReply({
      db,
      organizationId,
      payload: makeInbound(STAFF_PING_PHONE, 'Yes, refunds within 14 days — go ahead and tell the customer.'),
    })

    expect(result.branch).toBe('ask_staff_answer')

    // The reply landed as a staff-authored internal note on the ping's
    // conversation, mentioning the asking agent.
    const notes = await handle.db
      .select({
        authorType: internalNotes.authorType,
        authorId: internalNotes.authorId,
        body: internalNotes.body,
        mentions: internalNotes.mentions,
      })
      .from(internalNotes)
      .where(eq(internalNotes.conversationId, PING_CONVERSATION_ID))
    expect(notes).toHaveLength(1)
    expect(notes[0]?.authorType).toBe('staff')
    expect(notes[0]?.authorId).toBe(STAFF_PING_USER)
    expect(notes[0]?.body).toBe('Yes, refunds within 14 days — go ahead and tell the customer.')
    expect(notes[0]?.mentions).toContain(`agent:${MERIGPT_AGENT_ID}`)

    // The ping was claimed (soft-deleted) — not left live.
    const [live] = await handle.db
      .select({ claimedAt: pendingStaffPings.claimedAt })
      .from(pendingStaffPings)
      .where(
        and(eq(pendingStaffPings.staffUserId, STAFF_PING_USER), eq(pendingStaffPings.organizationId, organizationId)),
      )
      .limit(1)
    expect(live?.claimedAt).not.toBeNull()

    // No customer conversation for the staff member's reply.
    const customerMessages = await handle.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(conversations.channelInstanceId, NOTIF_INSTANCE_ID))
    expect(customerMessages).toHaveLength(0)
  })
})
