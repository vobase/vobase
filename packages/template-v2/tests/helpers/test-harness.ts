/**
 * Phase 1 integration test harness.
 *
 * Wires together the real runtime (EventBus + ObserverBus + MutatorChain + journal)
 * with real service REAL methods + the 3 shipped observers/mutators.
 *
 * Returns a `bootWakeIntegration(opts)` that runs a real wake against the real DB
 * and captures events + wakeId per wake — used by all 12 integration assertions.
 */

import { auditObserver } from '@modules/agents/observers/audit'
import { sseObserver } from '@modules/agents/observers/sse'
import { append as journalAppend, setDb as setAgentsDb } from '@modules/agents/service/journal'
import { approvalMutator } from '@modules/inbox/mutators/approval'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { AgentDefinition, Contact, DriveFile, StaffBinding } from '@server/contracts/domain-types'
import type { DrivePort, DriveScope } from '@server/contracts/drive-port'
import type { AgentEvent } from '@server/contracts/event'
import type { HarnessHandle, StreamFn } from '@server/harness'
import { bootWake } from '@server/harness'
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
  tenantId: string
  agentId: string
  contactId: string
  conversationId?: string
  mockStreamFn: StreamFn
  trigger?: Parameters<typeof bootWake>[0]['trigger']
  maxTurns?: number
  customSideLoad?: Parameters<HarnessHandle['registerSideLoadMaterializer']>[0][]
  preWakeWrites?: Array<{ path: string; content: string }>
}

/** Build once at the top of a test — provides the service ports wired against `db`. */
export async function buildIntegrationPorts(db: TestDbHandle): Promise<{
  agents: AgentsPort
  contacts: ContactsPort
  drive: DrivePort
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
        tenantId: (event as unknown as { tenantId: string }).tenantId,
        wakeId: (event as unknown as { wakeId?: string }).wakeId ?? null,
        turnIndex: (event as unknown as { turnIndex: number }).turnIndex ?? 0,
        event,
      })
    },
    async checkDailyCeiling() {
      return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
    },
  }

  const contactsPort: ContactsPort = {
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
    async readWorkingMemory(id: string): Promise<string> {
      const c = await this.get(id)
      return c.workingMemory
    },
    async upsertWorkingMemorySection() {
      throw new Error('not-implemented-in-phase-1')
    },
    async appendWorkingMemory() {
      throw new Error('not-implemented-in-phase-1')
    },
    async removeWorkingMemorySection() {
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
    async delete() {
      throw new Error('not-implemented-in-phase-1')
    },
  }

  const drivePort: DrivePort = {
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
    async delete() {
      throw new Error('not-implemented-in-phase-1')
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
 * Run a wake against the real DB with all 3 observers + approvalMutator wired.
 * Captures every event for this specific wake (B3 scoping).
 */
export async function bootWakeIntegration(
  ports: {
    agents: AgentsPort
    contacts: ContactsPort
    drive: DrivePort
  },
  opts: IntegrationBootOpts,
  db: TestDbHandle,
): Promise<IntegrationHarnessHandle> {
  // Capture SSE notify calls for assertion 10-ish (sseObserver smoke test).
  const notifySpyCalls: Array<{ table: string; id?: string; action?: string }> = []

  // Stub auditObserver's ctx.db with a real `.insert(t).values(v).returning()` shape.
  const _ctxDb = db.db

  const result = await bootWake({
    tenantId: opts.tenantId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    trigger: opts.trigger,
    mockStreamFn: opts.mockStreamFn,
    conversationId: opts.conversationId,
    maxTurns: opts.maxTurns ?? 1,
    registrations: {
      tools: [],
      commands: [],
      observers: [auditObserver, sseObserver],
      mutators: [approvalMutator],
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
 * Observer context wiring cheat — we swap ctx.db + ctx.realtime with real ones
 * via a small monkey-patch on the observer's handle. This is done once at import
 * time so the auditObserver + sseObserver see the real DB + a notify spy.
 *
 * Simpler than threading through bootWake's API.
 */
export function wireObserverContextFor(
  db: TestDbHandle,
  notifySpy: {
    calls: Array<{ table: string; id?: string; action?: string }>
  },
): () => void {
  const originalAudit = auditObserver.handle
  const originalAuditBound = originalAudit.bind(auditObserver)
  auditObserver.handle = async (event, ctx) => {
    const patchedCtx = { ...ctx, db: db.db }
    return originalAuditBound(event, patchedCtx)
  }
  const originalSse = sseObserver.handle
  const originalSseBound = originalSse.bind(sseObserver)
  sseObserver.handle = async (event, ctx) => {
    const patchedCtx = {
      ...ctx,
      realtime: {
        notify: (payload: { table: string; id?: string; action?: string }) => {
          notifySpy.calls.push(payload)
        },
      },
    }
    return originalSseBound(event, patchedCtx)
  }
  return () => {
    auditObserver.handle = originalAudit
    sseObserver.handle = originalSse
  }
}

/** Approval mutator needs ctx.db wired to the real drizzle handle. */
export function wireApprovalMutatorCtx(db: TestDbHandle): () => void {
  const original = approvalMutator.before
  if (!original) return () => undefined
  const originalBound = original.bind(approvalMutator)
  approvalMutator.before = async (step, ctx) => {
    const patchedCtx = { ...ctx, db: db.db }
    return originalBound(step, patchedCtx)
  }
  return () => {
    approvalMutator.before = original
  }
}
