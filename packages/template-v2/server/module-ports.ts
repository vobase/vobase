/**
 * Domain-port builders for the wake handler.
 *
 * Builds minimal InboxPort / ContactsService / AgentsPort / FilesService
 * wired directly against drizzle. Reads use drizzle; writes delegate to each
 * module's service layer so the one-write-path invariant holds. Several
 * write methods throw — those paths aren't exercised yet and should be
 * filled in when a caller needs them.
 *
 * The realtime service + job queue were salvaged out of this file into
 * `server/realtime.ts` and `server/jobs.ts` respectively; `buildPorts`
 * assembles the full bag for the wake handler.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import { agentDefinitions } from '@modules/agents/schema'
import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import { append as journalAppend, setDb as setJournalDb } from '@modules/agents/service/journal'
import type { AgentsPort } from '@modules/agents/service/types'
import type { Contact, StaffBinding } from '@modules/contacts/schema'
import { contacts, staffChannelBindings } from '@modules/contacts/schema'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { DriveFile } from '@modules/drive/schema'
import { driveFiles } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { DriveScope } from '@modules/drive/service/types'
import type { Conversation } from '@modules/inbox/schema'
import { conversations } from '@modules/inbox/schema'
import {
  createInboundMessage as svcCreateInboundMessage,
  resumeOrCreate as svcResumeOrCreate,
} from '@modules/inbox/service/conversations'
import {
  appendCardMessage,
  appendCardReplyMessage,
  appendTextMessage,
  list as svcListMessages,
} from '@modules/inbox/service/messages'
import { addNote as svcAddNote, listNotes as svcListNotes } from '@modules/inbox/service/notes'
import type { InboxPort } from '@modules/inbox/service/types'
import type { RealtimeService, ScopedDb } from '@server/common/port-types'
import type { AgentEvent } from '@server/contracts/event'
import { buildJobQueue } from '@server/jobs'
import { buildRealtime } from '@server/realtime'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Sql } from 'postgres'

export interface Ports {
  inbox: InboxPort
  contacts: ContactsService
  agents: AgentsPort
  drive: FilesService
  realtime: RealtimeService
  jobs: {
    send(name: string, data: unknown, opts?: { startAfter?: Date; singletonKey?: string }): Promise<string>
    cancel(jobId: string): Promise<void>
  }
}

interface WhereResult extends Promise<unknown[]> {
  limit: (n: number) => Promise<unknown[]>
}
interface DrizzleHandle {
  select: (fields?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => WhereResult
      limit: (n: number) => Promise<unknown[]>
    }
  }
  insert: (t: unknown) => {
    values: (v: unknown) => {
      returning: () => Promise<unknown[]>
      onConflictDoUpdate: (args: unknown) => { returning: () => Promise<unknown[]> }
    }
  }
  update: (t: unknown) => {
    set: (v: unknown) => {
      where: (c: unknown) => Promise<unknown>
    }
  }
}

/**
 * Build a minimal InboxPort that delegates every write to the existing service
 * layer (one-write-path). Reads use drizzle directly.
 */
function buildInboxPort(db: DrizzleHandle): InboxPort {
  const stubToolCtx = () => ({
    agentId: MERIDIAN_AGENT_ID,
    wakeId: `stub:${nanoid(8)}`,
    turnIndex: 0,
    toolCallId: `stub-${nanoid(8)}`,
  })

  return {
    async getConversation(id) {
      const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
      const row = rows[0] as Conversation | undefined
      if (!row) throw new Error(`inbox/getConversation: no conversation ${id}`)
      return row
    },
    async listMessages(conversationId, opts) {
      return svcListMessages(conversationId, opts)
    },
    async createConversation(input) {
      const { conversation } = await svcResumeOrCreate(
        input.organizationId,
        input.contactId,
        input.channelInstanceId,
        input.threadKey ?? 'default',
      )
      return conversation
    },
    async sendTextMessage(input) {
      const ctx = stubToolCtx()
      return appendTextMessage({
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        agentId: input.agentId ?? ctx.agentId,
        wakeId: input.wakeId ?? ctx.wakeId,
        turnIndex: input.turnIndex ?? ctx.turnIndex,
        toolCallId: input.toolCallId ?? ctx.toolCallId,
        text: input.body,
        replyToMessageId: input.parentMessageId,
      })
    },
    async sendCardMessage(input) {
      const ctx = stubToolCtx()
      return appendCardMessage({
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        agentId: input.agentId ?? ctx.agentId,
        wakeId: input.wakeId ?? ctx.wakeId,
        turnIndex: input.turnIndex ?? ctx.turnIndex,
        toolCallId: input.toolCallId ?? ctx.toolCallId,
        card: input.card,
        replyToMessageId: input.parentMessageId,
      })
    },
    async sendCardReply(input) {
      return appendCardReplyMessage(input)
    },
    async sendImageMessage() {
      throw new Error('ports: sendImageMessage not supported')
    },
    async sendMediaMessage() {
      throw new Error('ports: sendMediaMessage not supported')
    },
    async resolve() {
      throw new Error('ports: resolve not supported')
    },
    async reassign() {
      throw new Error('ports: reassign not supported')
    },
    async reopen() {
      throw new Error('ports: reopen not supported')
    },
    async reset() {
      throw new Error('ports: reset not supported')
    },
    async snooze() {
      throw new Error('ports: snooze not supported')
    },
    async unsnooze() {
      throw new Error('ports: unsnooze not supported')
    },
    async addInternalNote(input) {
      return svcAddNote(input)
    },
    async listInternalNotes(conversationId) {
      return svcListNotes(conversationId)
    },
    async insertPendingApproval() {
      throw new Error('ports: insertPendingApproval not supported outside wake')
    },
    async createInboundMessage(input) {
      return svcCreateInboundMessage(input)
    },
  }
}

function buildContactsService(db: DrizzleHandle): ContactsService {
  const notImpl = (): never => {
    throw new Error('ports: contacts method not implemented')
  }
  return {
    async get(id) {
      const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
      const r = rows[0] as Contact | undefined
      if (!r) throw new Error(`contacts/get: no contact ${id}`)
      return r
    },
    async getByPhone(organizationId, phone) {
      const rows = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, organizationId), eq(contacts.phone, phone)))
        .limit(1)
      return (rows[0] as Contact | undefined) ?? null
    },
    async getByEmail(organizationId, email) {
      const rows = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, organizationId), eq(contacts.email, email)))
        .limit(1)
      return (rows[0] as Contact | undefined) ?? null
    },
    async upsertByExternal(input) {
      if (input.phone) {
        const existing = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.organizationId, input.organizationId), eq(contacts.phone, input.phone)))
          .limit(1)
        if (existing[0]) return existing[0] as Contact
      }
      if (input.email) {
        const existing = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.organizationId, input.organizationId), eq(contacts.email, input.email)))
          .limit(1)
        if (existing[0]) return existing[0] as Contact
      }
      const rows = await db
        .insert(contacts)
        .values({
          organizationId: input.organizationId,
          displayName: input.displayName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          notes: '',
        })
        .returning()
      const row = rows[0] as Contact | undefined
      if (!row) throw new Error('contacts/upsertByExternal: insert returned no rows')
      return row
    },
    create: notImpl,
    update: notImpl,
    readNotes: notImpl,
    upsertNotesSection: notImpl,
    appendNotes: notImpl,
    removeNotesSection: notImpl,
    setSegments: notImpl,
    setMarketingOptOut: notImpl,
    async resolveStaffByExternal(channelInstanceId, externalIdentifier) {
      const rows = await db
        .select()
        .from(staffChannelBindings)
        .where(
          and(
            eq(staffChannelBindings.channelInstanceId, channelInstanceId),
            eq(staffChannelBindings.externalIdentifier, externalIdentifier),
          ),
        )
        .limit(1)
      return (rows[0] as StaffBinding | undefined) ?? null
    },
    bindStaff: notImpl,
    list: notImpl,
    remove: notImpl,
  } as ContactsService
}

function buildAgentsPort(db: DrizzleHandle): AgentsPort {
  return {
    async getAgentDefinition(id: string): Promise<AgentDefinition> {
      const rows = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1)
      const r = rows[0] as AgentDefinition | undefined
      if (!r) throw new Error(`agents/getAgentDefinition: no row for ${id}`)
      return r
    },
    async appendEvent(event: AgentEvent): Promise<void> {
      const anyEv = event as unknown as {
        conversationId: string
        organizationId: string
        wakeId?: string
        turnIndex?: number
      }
      await journalAppend({
        conversationId: anyEv.conversationId,
        organizationId: anyEv.organizationId,
        wakeId: anyEv.wakeId ?? null,
        turnIndex: anyEv.turnIndex ?? 0,
        event,
      })
    },
    async checkDailyCeiling() {
      return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
    },
  }
}

function buildFilesService(db: DrizzleHandle): FilesService {
  const notImpl = (): never => {
    throw new Error('ports/drive: write ops not implemented')
  }
  return {
    async get(id: string): Promise<DriveFile | null> {
      const rows = await db.select().from(driveFiles).where(eq(driveFiles.id, id)).limit(1)
      return (rows[0] as DriveFile | undefined) ?? null
    },
    async getByPath(scope: DriveScope, path: string): Promise<DriveFile | null> {
      const conds = [eq(driveFiles.scope, scope.scope), eq(driveFiles.path, path)]
      if (scope.scope === 'contact') conds.push(eq(driveFiles.scopeId, scope.contactId))
      const rows = await db
        .select()
        .from(driveFiles)
        .where(and(...conds))
        .limit(1)
      return (rows[0] as DriveFile | undefined) ?? null
    },
    async listFolder(scope: DriveScope, parentId: string | null): Promise<DriveFile[]> {
      const conds = [eq(driveFiles.scope, scope.scope)]
      if (scope.scope === 'contact') conds.push(eq(driveFiles.scopeId, scope.contactId))
      if (parentId !== null) conds.push(eq(driveFiles.parentFolderId, parentId))
      const rows = await db
        .select()
        .from(driveFiles)
        .where(and(...conds))
      return rows as DriveFile[]
    },
    async readContent(id: string): Promise<{ content: string; spilledToPath?: string }> {
      const f = await this.get(id)
      return { content: f?.extractedText ?? '' }
    },
    async grep() {
      return []
    },
    readPath: notImpl,
    writePath: notImpl,
    create: notImpl,
    mkdir: notImpl,
    move: notImpl,
    remove: notImpl,
    getBusinessMd: notImpl,
    ingestUpload: notImpl,
    saveInboundMessageAttachment: notImpl,
    deleteScope: notImpl,
  } as FilesService
}

export async function buildPorts(
  db: ScopedDb,
  sql: Sql,
  databaseConfig: string,
  jobHandlers: Map<string, (data: unknown) => Promise<void>>,
): Promise<Ports> {
  const drizzleDb = db as unknown as DrizzleHandle
  // Agents journal needs its db set or `appendTextMessage` will throw on the journal write.
  setJournalDb(db)
  void sql // reserved for future direct-sql ports; kept in signature for call-site stability
  return {
    inbox: buildInboxPort(drizzleDb),
    contacts: buildContactsService(drizzleDb),
    agents: buildAgentsPort(drizzleDb),
    drive: buildFilesService(drizzleDb),
    realtime: await buildRealtime(databaseConfig, db),
    jobs: buildJobQueue(jobHandlers),
  }
}
