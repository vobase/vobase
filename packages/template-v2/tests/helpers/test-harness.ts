/**
 * Phase 1 integration test harness.
 *
 * Wires together the real runtime (EventBus + ObserverBus + MutatorChain + journal)
 * with real service REAL methods + the 3 shipped observers/mutators.
 *
 * Returns a `bootWakeIntegration(opts)` that runs a real wake against the real DB
 * and captures events + wakeId per wake — used by all 12 integration assertions.
 */

import { sseListener } from '@modules/agents/observers/sse'
import type { AgentDefinition } from '@modules/agents/schema'
import type { AgentsPort } from '@modules/agents/service/types'
import type { Contact, StaffBinding } from '@modules/contacts/schema'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { DriveFile } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { DriveScope } from '@modules/drive/service/types'
import type { AgentEvent } from '@server/contracts/event'
import type { HarnessHandle, StreamFnLike } from '@server/harness'
import { bootWake } from '@server/harness'
import { journalAppend, setJournalDb as setAgentsDb } from '@vobase/core'
import { and, eq } from 'drizzle-orm'
import type { TestDbHandle } from './test-db'

export interface IntegrationHarnessHandle {
  harness: HarnessHandle
  conversationId: string
  wakeId: string
  /** Every event published during THIS wake (populated by the handle's subscribe). */
  capturedEvents: readonly AgentEvent[]
  notifySpyCalls: Array<{ table: string; id?: string; action?: string }>
}

export interface IntegrationBootOpts {
  organizationId: string
  agentId: string
  contactId: string
  conversationId?: string
  mockStreamFn: StreamFnLike
  trigger?: Parameters<typeof bootWake>[0]['trigger']
  maxTurns?: number
  customSideLoad?: Parameters<HarnessHandle['registerSideLoadMaterializer']>[0][]
  preWakeWrites?: Array<{ path: string; content: string }>
}

/** Build once at the top of a test — provides the service ports wired against `db`. */
export async function buildIntegrationPorts(db: TestDbHandle): Promise<{
  agents: AgentsPort
  contacts: ContactsService
  drive: FilesService
}> {
  setAgentsDb(db.db)

  const { agentDefinitions } = await import('@modules/agents/schema')
  const { contacts, staffChannelBindings } = await import('@modules/contacts/schema')
  const { driveFiles } = await import('@modules/drive/schema')

  const agents: AgentsPort = {
    async getAgentDefinition(id: string): Promise<AgentDefinition> {
      const rows = await db.db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1)
      const r = rows[0]
      if (!r) throw new Error(`agents.getAgentDefinition: no row for ${id}`)
      return r as unknown as AgentDefinition
    },
    async appendEvent(event: AgentEvent): Promise<void> {
      await journalAppend({
        conversationId: (event as unknown as { conversationId: string }).conversationId,
        organizationId: (event as unknown as { organizationId: string }).organizationId,
        wakeId: (event as unknown as { wakeId?: string }).wakeId ?? null,
        turnIndex: (event as unknown as { turnIndex: number }).turnIndex ?? 0,
        event,
      })
    },
    async checkDailyCeiling() {
      return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
    },
  }

  const contactsPort: ContactsService = {
    async get(id: string): Promise<Contact> {
      const rows = await db.db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
      const r = rows[0]
      if (!r) throw new Error(`contacts.get: no row for ${id}`)
      return r as unknown as Contact
    },
    async getByPhone(): Promise<Contact | null> {
      return null
    },
    async getByEmail(): Promise<Contact | null> {
      return null
    },
    async upsertByExternal(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    async create(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    async update(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    async readNotes(id: string): Promise<string> {
      const c = await this.get(id)
      return c.notes
    },
    async upsertNotesSection() {
      throw new Error('not-implemented-in-phase-1')
    },
    async appendNotes() {
      throw new Error('not-implemented-in-phase-1')
    },
    async removeNotesSection() {
      throw new Error('not-implemented-in-phase-1')
    },
    async setSegments() {
      throw new Error('not-implemented-in-phase-1')
    },
    async setMarketingOptOut() {
      throw new Error('not-implemented-in-phase-1')
    },
    async resolveStaffByExternal(channelInstanceId: string, ext: string): Promise<StaffBinding | null> {
      const rows = await db.db
        .select()
        .from(staffChannelBindings)
        .where(
          and(
            eq(staffChannelBindings.channelInstanceId, channelInstanceId),
            eq(staffChannelBindings.externalIdentifier, ext),
          ),
        )
        .limit(1)
      return (rows[0] as unknown as StaffBinding) ?? null
    },
    async bindStaff(): Promise<StaffBinding> {
      throw new Error('not-implemented-in-phase-1')
    },
    async list(): Promise<Contact[]> {
      return []
    },
    async remove() {
      throw new Error('not-implemented-in-phase-1')
    },
  }

  const drivePort: FilesService = {
    async get(id: string): Promise<DriveFile | null> {
      const rows = await db.db.select().from(driveFiles).where(eq(driveFiles.id, id)).limit(1)
      return (rows[0] as unknown as DriveFile) ?? null
    },
    async getByPath(scope: DriveScope, path: string): Promise<DriveFile | null> {
      const conds = [eq(driveFiles.scope, scope.scope), eq(driveFiles.path, path)]
      if (scope.scope === 'contact') {
        conds.push(eq(driveFiles.scopeId, scope.contactId))
      }
      const rows = await db.db
        .select()
        .from(driveFiles)
        .where(and(...conds))
        .limit(1)
      return (rows[0] as unknown as DriveFile) ?? null
    },
    async listFolder(scope: DriveScope, parentId: string | null): Promise<DriveFile[]> {
      const conds = [eq(driveFiles.scope, scope.scope)]
      if (scope.scope === 'contact') conds.push(eq(driveFiles.scopeId, scope.contactId))
      if (parentId !== null) conds.push(eq(driveFiles.parentFolderId, parentId))
      const rows = await db.db
        .select()
        .from(driveFiles)
        .where(and(...conds))
      return rows as unknown as DriveFile[]
    },
    async readContent(id: string): Promise<{ content: string; spilledToPath?: string }> {
      const f = await this.get(id)
      return { content: f?.extractedText ?? '' }
    },
    async readPath(scope: DriveScope, path: string) {
      const f = await this.getByPath(scope, path)
      if (!f) return null
      return { content: f.extractedText ?? '', virtual: false, file: f }
    },
    async writePath(): Promise<null> {
      throw new Error('not-implemented-in-phase-1')
    },
    async grep() {
      return []
    },
    async create(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    async mkdir(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    async move(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    async remove() {
      throw new Error('not-implemented-in-phase-1')
    },
    async getBusinessMd() {
      const biz = await this.getByPath({ scope: 'organization' }, '/BUSINESS.md')
      return biz?.extractedText ?? ''
    },
    async ingestUpload(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    async saveInboundMessageAttachment(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    async deleteScope() {
      throw new Error('not-implemented-in-phase-1')
    },
  }

  return { agents, contacts: contactsPort, drive: drivePort }
}

/**
 * Run a wake against the real DB with sseObserver wired.
 * Captures every event for this specific wake (B3 scoping).
 */
export async function bootWakeIntegration(
  ports: {
    agents: AgentsPort
    contacts: ContactsService
    drive: FilesService
  },
  opts: IntegrationBootOpts,
  db: TestDbHandle,
): Promise<IntegrationHarnessHandle> {
  const notifySpyCalls: Array<{ table: string; id?: string; action?: string }> = []
  const _ctxDb = db.db

  const result = await bootWake({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    trigger: opts.trigger,
    streamFn: opts.mockStreamFn,
    conversationId: opts.conversationId,
    maxTurns: opts.maxTurns ?? 1,
    registrations: {
      tools: [],
      commands: [],
      observers: [{ id: 'agents:sse', handle: sseListener }],
      mutators: [],
      materializers: [],
      sideLoadContributors: [],
    },
    ports,
    preWakeWrites: opts.preWakeWrites,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })

  // The harness.events array has every AgentEvent from this wake.
  return {
    harness: result.harness,
    conversationId: result.conversationId,
    wakeId: result.wakeId,
    capturedEvents: result.harness.events,
    notifySpyCalls,
  }
}

/**
 * Install the real DB + a notify spy into `server/services.ts` singletons so
 * sseObserver can be exercised against real Postgres + a capturing realtime.
 * Observers read these through `getDb()` / `getRealtime()` — no monkey-patch
 * of `handle` needed.
 */
export function wireObserverContextFor(
  db: TestDbHandle,
  notifySpy: {
    calls: Array<{ table: string; id?: string; action?: string }>
  },
): () => void {
  const { setDb, setRealtime, setLogger } = require('@server/services') as typeof import('@server/services')
  setDb(db.db as unknown as Parameters<typeof setDb>[0])
  setRealtime({
    notify: (payload: { table: string; id?: string; action?: string }) => {
      notifySpy.calls.push(payload)
    },
    subscribe: () => () => {},
  })
  setLogger({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  })
  void sseListener
  return () => {
    const { __resetServicesForTests } = require('@server/services') as typeof import('@server/services')
    __resetServicesForTests()
  }
}
