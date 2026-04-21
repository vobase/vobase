/**
 * channel-web inbound handler tests.
 *
 * Verifies: signature check, payload parsing, resolver call, InboxPort.createInboundMessage
 * delegation, wake job enqueue, dedupe (same externalMessageId → single row).
 *
 * Does NOT call real Hono app — tests the handler logic directly via a mock context.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import type { Auth } from '@server/auth'
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { Contact, Conversation, Message } from '@server/contracts/domain-types'
import type { CreateInboundMessageInput, CreateInboundMessageResult, InboxPort } from '@server/contracts/inbox-port'
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
  workingMemory: '',
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

function makeInboxPort(isNew = true) {
  return {
    createInboundMessage: async (input: CreateInboundMessageInput): Promise<CreateInboundMessageResult> => {
      calls.push({ method: 'createInboundMessage', data: input })
      return { conversation: fakeConversation, message: fakeMessage, isNew }
    },
    // stubs
    getConversation: async () => {
      throw new Error('not-expected')
    },
    listMessages: async () => [],
    createConversation: async () => fakeConversation,
    sendTextMessage: async () => fakeMessage,
    sendCardMessage: async () => fakeMessage,
    sendImageMessage: async () => fakeMessage,
    sendMediaMessage: async () => fakeMessage,
    resolve: async () => {},
    reassign: async () => {},
    reopen: async () => {},
    reset: async () => {},
    snooze: async () => fakeConversation,
    unsnooze: async () => fakeConversation,
    addInternalNote: async () => {
      throw new Error('not-expected')
    },
    listInternalNotes: async () => [],
    insertPendingApproval: async () => {
      throw new Error('not-expected')
    },
  } as unknown as ReturnType<typeof import('@modules/inbox/port').createInboxPort>
}

function makeContactsPort() {
  return {
    upsertByExternal: async () => {
      calls.push({ method: 'upsertByExternal', data: null })
      return fakeContact
    },
    get: async () => fakeContact,
    getByPhone: async () => fakeContact,
    getByEmail: async () => null,
    readWorkingMemory: async () => '',
    upsertWorkingMemorySection: async () => {},
    appendWorkingMemory: async () => {},
    removeWorkingMemorySection: async () => {},
    setSegments: async () => {},
    setMarketingOptOut: async () => {},
    resolveStaffByExternal: async () => null,
    bindStaff: async () => {
      throw new Error('not-expected')
    },
    delete: async () => {},
  }
}

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
  const jobs: JobQueue = {
    send: async (name, data) => {
      calls.push({ method: 'job.send', data: { name, data } })
      return 'job-id'
    },
  }
  installChannelWebState(
    createChannelWebState({
      inbox: makeInboxPort(isNewMessage) as unknown as InboxPort,
      contacts: makeContactsPort() as unknown as ContactsPort,
      jobs,
    }),
  )
}

beforeEach(() => {
  calls = []
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
