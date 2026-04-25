/**
 * Integration test harness helpers — provides service ports wired against a
 * real test DB and a `bootWakeIntegration` shim built on top of core's
 * `createHarness`.
 *
 * Currently unused by the active test suite (phase1–4 tests were removed in
 * earlier slices), but kept compiling so ad-hoc integration tests can reach
 * for it without re-deriving the port wiring.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import { agentDefinitions } from '@modules/agents/schema'
import type { AgentsPort } from '@modules/agents/service/types'
import type { Contact, StaffBinding } from '@modules/contacts/schema'
import { contacts, staffChannelBindings } from '@modules/contacts/schema'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { DriveFile } from '@modules/drive/schema'
import { driveFiles } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { DriveScope } from '@modules/drive/service/types'
import type { AgentEvent, WakeTrigger } from '@server/events'
import { buildFrozenPrompt } from '@server/harness/frozen-prompt-builder'
import { createModel, resolveApiKey } from '@server/harness/llm-provider'
import { __resetServicesForTests, setDb, setLogger, setRealtime } from '@server/services'
import { buildDefaultReadOnlyConfig, conversationVerbs, driveVerbs, teamVerbs } from '@server/workspace'
import { createWorkspace } from '@server/workspace/create-workspace'
import {
  createHarness,
  DirtyTracker,
  type HarnessEvent,
  type HarnessHandle,
  journalAppend,
  type OnEventListener,
  type StreamFnLike,
  setJournalDb as setAgentsDb,
  type WakeRuntime,
} from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import type { TestDbHandle } from './test-db'

export interface IntegrationHarnessHandle {
  harness: HarnessHandle<WakeTrigger>
  conversationId: string
  wakeId: string
  /** Every event published during THIS wake. */
  capturedEvents: readonly HarnessEvent<WakeTrigger>[]
  notifySpyCalls: Array<{ table: string; id?: string; action?: string }>
}

export interface IntegrationBootOpts {
  organizationId: string
  agentId: string
  contactId: string
  conversationId?: string
  channelInstanceId?: string
  mockStreamFn: StreamFnLike
  trigger?: WakeTrigger
  maxTurns?: number
  preWakeWrites?: Array<{ path: string; content: string }>
}

/** Build once at the top of a test — provides the service ports wired against `db`. */
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function buildIntegrationPorts(db: TestDbHandle): Promise<{
  agents: AgentsPort
  contacts: ContactsService
  drive: FilesService
}> {
  setAgentsDb(db.db)

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
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
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
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async getByPhone(): Promise<Contact | null> {
      return null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async getByEmail(): Promise<Contact | null> {
      return null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async upsertByExternal(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async create(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async update(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    async readNotes(id: string): Promise<string> {
      const c = await this.get(id)
      return c.notes
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async upsertNotesSection() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async appendNotes() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async removeNotesSection() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async setSegments() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
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
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async bindStaff(): Promise<StaffBinding> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async list(): Promise<Contact[]> {
      return []
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
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
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async writePath(): Promise<null> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async grep() {
      return []
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async create(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async mkdir(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async move(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async remove() {
      throw new Error('not-implemented-in-phase-1')
    },
    async getBusinessMd() {
      const biz = await this.getByPath({ scope: 'organization' }, '/BUSINESS.md')
      return biz?.extractedText ?? ''
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async ingestUpload(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async saveInboundMessageAttachment(): Promise<DriveFile> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async deleteScope() {
      throw new Error('not-implemented-in-phase-1')
    },
  }

  return { agents, contacts: contactsPort, drive: drivePort }
}

/**
 * Run a wake against the real DB. Minimal integration helper on top of
 * `createHarness` — captures every event for assertions.
 */
export async function bootWakeIntegration(
  ports: {
    agents: AgentsPort
    contacts: ContactsService
    drive: FilesService
  },
  opts: IntegrationBootOpts,
  _db: TestDbHandle,
): Promise<IntegrationHarnessHandle> {
  const notifySpyCalls: Array<{ table: string; id?: string; action?: string }> = []
  const capturedEvents: HarnessEvent<WakeTrigger>[] = []

  const captureListener: OnEventListener<WakeTrigger> = (ev) => {
    capturedEvents.push(ev)
  }

  const agentDefinition = await ports.agents.getAgentDefinition(opts.agentId)
  const channelInstanceId = opts.channelInstanceId ?? 'ci-integration'
  const workspace = await createWorkspace({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    conversationId: opts.conversationId ?? 'conv-integration',
    channelInstanceId,
    wakeId: 'w-integration',
    agentDefinition,
    commands: [...teamVerbs, ...conversationVerbs, ...driveVerbs],
    materializers: [],
    drivePort: ports.drive,
    readOnlyConfig: buildDefaultReadOnlyConfig({
      agentId: opts.agentId,
      contactId: opts.contactId,
      channelInstanceId,
    }),
  })

  const frozen = await buildFrozenPrompt({
    bash: workspace.bash,
    agentDefinition,
    organizationId: opts.organizationId,
    contactId: opts.contactId,
    channelInstanceId,
  })

  const model = createModel(agentDefinition.model)

  const runtime: WakeRuntime = {
    fs: workspace.innerFs,
    tracker: new DirtyTracker(new Map(), [], []),
  }

  const result = await createHarness<WakeTrigger>({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    conversationId: opts.conversationId,

    agentDefinition: {
      model: agentDefinition.model,
      instructions: agentDefinition.instructions,
      workingMemory: agentDefinition.workingMemory,
    },
    model,
    getApiKey: () => resolveApiKey(model),
    streamFn: opts.mockStreamFn,

    systemPrompt: frozen.system,
    systemHash: frozen.systemHash,

    trigger: opts.trigger,
    triggerKind: opts.trigger?.trigger,
    renderTrigger: (t) => (t ? `wake:${t.trigger}` : 'manual wake'),

    workspace: { bash: workspace.bash, innerFs: workspace.innerFs },
    runtime,

    tools: [],
    hooks: { on_event: [captureListener] },
    materializers: [],
    sideLoadContributors: [],
    commands: [...teamVerbs, ...conversationVerbs, ...driveVerbs],

    journalAppend: async (ev) => {
      await ports.agents.appendEvent(ev as unknown as AgentEvent)
    },

    preWakeWrites: opts.preWakeWrites,
    maxTurns: opts.maxTurns ?? 1,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })

  return {
    harness: result.harness,
    conversationId: result.conversationId,
    wakeId: result.wakeId,
    capturedEvents,
    notifySpyCalls,
  }
}

/**
 * Install the real DB + a notify spy into `server/services.ts` singletons so
 * observers can be exercised against real Postgres + a capturing realtime.
 */
export function wireObserverContextFor(
  db: TestDbHandle,
  notifySpy: {
    calls: Array<{ table: string; id?: string; action?: string }>
  },
): () => void {
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
  return () => {
    __resetServicesForTests()
  }
}
