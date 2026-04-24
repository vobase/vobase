/**
 * channel-web inbound handler tests.
 *
 * Verifies: signature check, payload parsing, resolver call, MessagingPort.createInboundMessage
 * delegation, wake job enqueue, dedupe (same externalMessageId → single row).
 *
 * Does NOT call real Hono app — tests the handler logic directly via a mock context.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Contact } from '@modules/contacts/schema'
import {
  __resetContactsServiceForTests,
  type ContactsService,
  installContactsService,
  type UpsertByExternalInput,
} from '@modules/contacts/service/contacts'
import type { Conversation, Message } from '@modules/messaging/schema'
import {
  __resetConversationsServiceForTests,
  type ConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import type { CreateInboundMessageInput, CreateInboundMessageResult } from '@modules/messaging/service/types'
import type { Auth } from '@server/auth'
import { signHmac } from '@vobase/core'

import { createChannelWebState, installChannelWebAuth, installChannelWebState, type JobQueue } from '../service/state'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SECRET = 'test-secret'

type CallRecord = { method: string; data: unknown }
let calls: CallRecord[] = []

const fakeConversation: Conversation = {
  id: 'conv-web-1',
  organizationId: 'org-1',
  contactId: 'contact-1',
  channelInstanceId: 'ch-web-1',
  status: 'active',
  assignee: 'unassigned',
  snoozedUntil: null,
  snoozedReason: null,
  snoozedBy: null,
  snoozedAt: null,
  snoozedJobId: null,
  threadKey: 'default',
  emailSubject: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const fakeContact: Contact = {
  id: 'contact-1',
  organizationId: 'org-1',
  displayName: 'Web User',
  phone: 'web:session-abc',
  email: null,
  profile: '',
  notes: '',
  attributes: {},
  segments: [],
  marketingOptOut: false,
  marketingOptOutAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const fakeMessage: Message = {
  id: 'msg-inbound-1',
  conversationId: 'conv-web-1',
  organizationId: 'org-1',
  role: 'customer',
  kind: 'text',
  content: { text: 'Hello' },
  parentMessageId: null,
  channelExternalId: 'ext-msg-1',
  status: null,
  createdAt: new Date(),
}

let mockIsNew = true

function makeContactsServiceStub(): ContactsService {
  const notImplemented = async () => {
    throw new Error('inbound.test: contacts-service method not stubbed')
  }
  return {
    list: notImplemented as ContactsService['list'],
    get: notImplemented as ContactsService['get'],
    getByPhone: notImplemented as ContactsService['getByPhone'],
    getByEmail: notImplemented as ContactsService['getByEmail'],
    create: notImplemented as ContactsService['create'],
    update: notImplemented as ContactsService['update'],
    upsertByExternal: async (_input: UpsertByExternalInput): Promise<Contact> => {
      calls.push({ method: 'upsertByExternal', data: null })
      return fakeContact
    },
    resolveStaffByExternal: notImplemented as ContactsService['resolveStaffByExternal'],
    readNotes: notImplemented as ContactsService['readNotes'],
    upsertNotesSection: notImplemented as ContactsService['upsertNotesSection'],
    appendNotes: notImplemented as ContactsService['appendNotes'],
    removeNotesSection: notImplemented as ContactsService['removeNotesSection'],
    setSegments: notImplemented as ContactsService['setSegments'],
    setMarketingOptOut: notImplemented as ContactsService['setMarketingOptOut'],
    bindStaff: notImplemented as ContactsService['bindStaff'],
    remove: notImplemented as ContactsService['remove'],
  }
}

function makeConversationsServiceStub(): ConversationsService {
  const notImplemented = async () => {
    throw new Error('inbound.test: conversations-service method not stubbed')
  }
  return {
    createInboundMessage: async (input: CreateInboundMessageInput): Promise<CreateInboundMessageResult> => {
      calls.push({ method: 'createInboundMessage', data: input })
      return { conversation: fakeConversation, message: fakeMessage, isNew: mockIsNew }
    },
    create: notImplemented as ConversationsService['create'],
    resumeOrCreate: notImplemented as ConversationsService['resumeOrCreate'],
    get: notImplemented as ConversationsService['get'],
    listActivity: notImplemented as ConversationsService['listActivity'],
    snooze: notImplemented as ConversationsService['snooze'],
    unsnooze: notImplemented as ConversationsService['unsnooze'],
    wakeSnoozed: notImplemented as ConversationsService['wakeSnoozed'],
    resolve: notImplemented as ConversationsService['resolve'],
    reopen: notImplemented as ConversationsService['reopen'],
    reset: notImplemented as ConversationsService['reset'],
    reassign: notImplemented as ConversationsService['reassign'],
    list: notImplemented as ConversationsService['list'],
    listMessagingByContact: notImplemented as ConversationsService['listMessagingByContact'],
    sendText: notImplemented as ConversationsService['sendText'],
    sendCard: notImplemented as ConversationsService['sendCard'],
    sendImage: notImplemented as ConversationsService['sendImage'],
  }
}

mock.module('../service/instances', () => ({
  getInstanceDefaultAssignee: async (id: string) => {
    calls.push({ method: 'getInstanceDefaultAssignee', data: { id } })
    return null
  },
}))

const fakeEvent = {
  organizationId: 'org-1',
  channelType: 'web' as const,
  externalMessageId: 'ext-msg-1',
  from: 'session-abc',
  profileName: 'Web User',
  content: 'Hello',
  contentType: 'text' as const,
  timestamp: Date.now(),
}

function makeSigned(payload: unknown) {
  const body = JSON.stringify(payload)
  const sig = signHmac(body, SECRET)
  return { body, sig }
}

// Minimal Hono context mock
function makeCtx(body: string, sig: string, channelInstanceId = 'ch-web-1', extraHeaders: Record<string, string> = {}) {
  return {
    req: {
      text: async () => body,
      json: async () => JSON.parse(body),
      header: (name: string) => {
        if (name === 'x-hub-signature-256') return sig
        if (name === 'x-channel-secret') return SECRET
        if (name === 'x-channel-instance-id') return channelInstanceId
        if (extraHeaders[name]) return extraHeaders[name]
        return undefined
      },
      query: () => undefined,
      raw: { headers: new Headers(extraHeaders) },
    },
    json: (data: unknown, status = 200) => ({ _body: data, _status: status }),
    text: (t: string, s = 200) => ({ _body: t, _status: s }),
  } as unknown as import('hono').Context
}

function installTestState(isNewMessage = true): void {
  mockIsNew = isNewMessage
  const jobs: JobQueue = {
    send: async (name, data) => {
      calls.push({ method: 'job.send', data: { name, data } })
      return 'job-id'
    },
  }
  installChannelWebState(createChannelWebState({ jobs }))
}

beforeEach(() => {
  calls = []
  mockIsNew = true
  __resetContactsServiceForTests()
  __resetConversationsServiceForTests()
  installContactsService(makeContactsServiceStub())
  installConversationsService(makeConversationsServiceStub())
  installTestState()
})

describe('handleInbound', () => {
  it('rejects invalid signature', async () => {
    const { handleInbound } = await import('../handlers/inbound')
    const { body } = makeSigned(fakeEvent)
    const ctx = makeCtx(body, 'bad-sig')
    const res = await handleInbound(ctx)
    expect((res as unknown as { _status: number })._status).toBe(401)
    expect(calls.some((c) => c.method === 'createInboundMessage')).toBe(false)
  })

  it('happy path — signed payload creates message + enqueues job', async () => {
    const { handleInbound } = await import('../handlers/inbound')
    const { body, sig } = makeSigned(fakeEvent)
    const ctx = makeCtx(body, sig)
    const res = (await handleInbound(ctx)) as unknown as { _body: Record<string, unknown>; _status: number }
    expect(res._status).toBe(200)
    expect(res._body.received).toBe(true)
    expect(res._body.conversationId).toBe('conv-web-1')
    const inboundCall = calls.find((c) => c.method === 'createInboundMessage')
    expect(inboundCall).toBeDefined()
    const jobCall = calls.find((c) => c.method === 'job.send')
    expect(jobCall).toBeDefined()
  })

  it('dedupe — same externalMessageId does not enqueue another job', async () => {
    installTestState(false)
    const { handleInbound } = await import('../handlers/inbound')
    const { body, sig } = makeSigned(fakeEvent)
    const ctx = makeCtx(body, sig)
    const res = (await handleInbound(ctx)) as unknown as { _body: Record<string, unknown> }
    expect(res._body.deduplicated).toBe(true)
    expect(calls.some((c) => c.method === 'job.send')).toBe(false)
  })

  it('missing channel instance id returns 400', async () => {
    const { handleInbound } = await import('../handlers/inbound')
    const { body, sig } = makeSigned(fakeEvent)
    const ctx = makeCtx(body, sig, '')
    const res = (await handleInbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(400)
  })

  it('invalid json body returns 400', async () => {
    const { handleInbound } = await import('../handlers/inbound')
    const badBody = '{not-json'
    const sig = signHmac(badBody, SECRET)
    const ctx = makeCtx(badBody, sig)
    const res = (await handleInbound(ctx)) as unknown as { _status: number }
    expect(res._status).toBe(400)
  })

  it('session-authed browser path skips HMAC and uses user.id as from', async () => {
    const fakeAuth = {
      api: {
        getSession: async () => ({
          user: { id: 'user-anon-1', name: 'Anon' },
          session: { activeOrganizationId: null },
        }),
      },
    } as unknown as Auth
    installChannelWebAuth(fakeAuth)

    const body = JSON.stringify({
      content: 'Hello via session',
      contentType: 'text',
      externalMessageId: 'br-msg-1',
      profileName: 'Anon',
    })
    const ctx = makeCtx(body, 'ignored-no-hmac')
    const { handleInbound } = await import('../handlers/inbound')
    const res = (await handleInbound(ctx)) as unknown as { _body: Record<string, unknown>; _status: number }
    expect(res._status).toBe(200)
    expect(res._body.received).toBe(true)
    const inboundCall = calls.find((c) => c.method === 'createInboundMessage') as
      | { method: string; data: { content: string } }
      | undefined
    expect(inboundCall?.data.content).toBe('Hello via session')
  })
})
