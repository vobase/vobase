/**
 * Phase 3 harness factory.
 *
 * Assembles a `bootWake()` call with the full Phase-3 observer + mutator set
 * wired on top of the Phase-1/2 green-thread. Purely additive: Phase 1/2 tests
 * keep using `buildIntegrationPorts` + `bootWakeIntegration`; this helper is
 * opt-in for tests that need the richer runtime.
 *
 * Observers (beyond the two the runner auto-wires — `workspaceSyncObserver` +
 * `memoryDistillObserver`):
 *   - `auditObserver`
 *   - `sseObserver`
 *   - `scorerObserver`
 *   - `learningProposalObserver`
 *
 * Mutators:
 *   - `moderationMutator`  (runs first, can block pre-execution)
 *   - `approvalMutator`    (card/file/book_slot gate)
 *
 * Stub ports are provided for unit-level tests that don't need a real DB
 * (e.g. adapter-level bash fixture replay). Callers with a real DB should
 * keep using `buildIntegrationPorts(db)` and pass the ports in via
 * `overridePorts` to get live journaling.
 */

import { moderationMutator } from '@modules/agents/mutators/moderation'
import { auditObserver } from '@modules/agents/observers/audit'
import { createLearningProposalObserver } from '@modules/agents/observers/learning-proposal'
import { createScorerObserver } from '@modules/agents/observers/scorer'
import { sseObserver } from '@modules/agents/observers/sse'
import { approvalMutator } from '@modules/inbox/mutators/approval'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { AgentDefinition, Contact, DriveFile, StaffBinding } from '@server/contracts/domain-types'
import type { DrivePort, DriveScope } from '@server/contracts/drive-port'
import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import type { PluginContext } from '@server/contracts/plugin-context'
import type { LlmProvider } from '@server/contracts/provider-port'
import type { BootWakeOpts, BootWakeResult, ModuleRegistrationsSnapshot } from '@server/harness'
import { bootWake } from '@server/harness'
import type { StreamFn } from '@server/harness/mock-stream'

export interface Phase3Ports {
  agents: AgentsPort
  contacts: ContactsPort
  drive: DrivePort
}

export interface MakePhase3Opts {
  organizationId: string
  agentId: string
  contactId: string
  conversationId?: string
  /** Use a real provider (recorded fixture or live) — required for bash turns. */
  provider?: LlmProvider
  /** Mock stream — required when `provider` is unset. */
  mockStreamFn?: StreamFn
  maxTurns?: number
  trigger?: BootWakeOpts['trigger']
  preWakeWrites?: BootWakeOpts['preWakeWrites']
  /**
   * Override any port. When omitted, a minimal stub backed by an in-memory
   * Map is provided — sufficient for fixture-replay unit tests.
   */
  overridePorts?: Partial<Phase3Ports>
  /**
   * llmCall injected into observers that need it (scorer, learning-proposal).
   * Defaults to a stub that returns empty JSON so observers can run without a
   * live LLM.
   */
  llmCall?: PluginContext['llmCall']
  /**
   * Extra mutators appended after the Phase-3 baseline. Left unshifted so
   * moderation + approval still run first.
   */
  extraMutators?: ModuleRegistrationsSnapshot['mutators']
  /** Extra observers appended after the Phase-3 baseline. */
  extraObservers?: ModuleRegistrationsSnapshot['observers']
  /** Extra tools + commands pulled into `toolIndex` / side-load (e.g. `vobase` CLI). */
  extraTools?: ModuleRegistrationsSnapshot['tools']
  extraCommands?: ModuleRegistrationsSnapshot['commands']
  extraSideLoadContributors?: ModuleRegistrationsSnapshot['sideLoadContributors']
  extraMaterializers?: ModuleRegistrationsSnapshot['materializers']
}

const noopLlmCall: PluginContext['llmCall'] = async (task) => ({
  task,
  model: 'stub',
  provider: 'stub',
  content: '{"score":0.75,"rationale":"stub"}' as never,
  tokensIn: 0,
  tokensOut: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  cacheHit: false,
})

/** Build the Phase-3 registrations snapshot with observers/mutators pre-wired. */
export function buildWorkspaceAgentRegistrations(opts: {
  contactId: string
  agentId: string
  llmCall?: PluginContext['llmCall']
  extraMutators?: ModuleRegistrationsSnapshot['mutators']
  extraObservers?: ModuleRegistrationsSnapshot['observers']
  extraTools?: ModuleRegistrationsSnapshot['tools']
  extraCommands?: ModuleRegistrationsSnapshot['commands']
  extraSideLoadContributors?: ModuleRegistrationsSnapshot['sideLoadContributors']
  extraMaterializers?: ModuleRegistrationsSnapshot['materializers']
}): ModuleRegistrationsSnapshot {
  const llmCall = opts.llmCall ?? noopLlmCall
  const observers: AgentObserver[] = [
    auditObserver,
    sseObserver,
    createScorerObserver({ llmCall }),
    createLearningProposalObserver({ contactId: opts.contactId, agentId: opts.agentId, llmCall }),
    ...(opts.extraObservers ?? []),
  ]
  return {
    tools: [...(opts.extraTools ?? [])],
    commands: [...(opts.extraCommands ?? [])],
    observers,
    mutators: [moderationMutator, approvalMutator, ...(opts.extraMutators ?? [])],
    materializers: [...(opts.extraMaterializers ?? [])],
    sideLoadContributors: [...(opts.extraSideLoadContributors ?? [])],
  }
}

/** Fixed stub agent definition — satisfies `AgentsPort.getAgentDefinition`. */
export function stubAgentDefinition(agentId: string, organizationId: string): AgentDefinition {
  return {
    id: agentId,
    organizationId,
    name: 'phase3-stub-agent',
    soulMd: '# Role: Phase 3 Stub Agent',
    model: 'claude-sonnet-4-6',
    maxSteps: 4,
    workingMemory: '# Memory\n\n_empty_',
    skillAllowlist: null,
    cardApprovalRequired: false,
    fileApprovalRequired: false,
    bookSlotApprovalRequired: false,
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    maxOutputTokens: null,
    maxInputTokens: null,
    maxTurnsPerWake: null,
    softCostCeilingUsd: null,
    hardCostCeilingUsd: null,
  }
}

/** Build throwaway in-memory ports — enough to boot a wake without a real DB. */
export function stubPhase3Ports(args: { organizationId: string; agentId: string; contactId: string }): Phase3Ports {
  const stubContact: Contact = {
    id: args.contactId,
    organizationId: args.organizationId,
    displayName: 'Phase 3 Test Contact',
    phone: null,
    email: null,
    workingMemory: '# Memory\n',
    segments: [],
    marketingOptOut: false,
    marketingOptOutAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }

  const appended: AgentEvent[] = []

  const agents: AgentsPort = {
    async getAgentDefinition(): Promise<AgentDefinition> {
      return stubAgentDefinition(args.agentId, args.organizationId)
    },
    async appendEvent(event): Promise<void> {
      appended.push(event)
    },
    async checkDailyCeiling() {
      return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
    },
  }

  const workingMemoryByContact = new Map<string, string>()
  workingMemoryByContact.set(args.contactId, stubContact.workingMemory)

  const contacts: ContactsPort = {
    async get(): Promise<Contact> {
      return { ...stubContact, workingMemory: workingMemoryByContact.get(args.contactId) ?? '# Memory\n' }
    },
    async getByPhone() {
      return null
    },
    async getByEmail() {
      return null
    },
    async upsertByExternal(): Promise<Contact> {
      throw new Error('stubPhase3Ports: upsertByExternal not implemented')
    },
    async readWorkingMemory(): Promise<string> {
      return workingMemoryByContact.get(args.contactId) ?? '# Memory\n'
    },
    async upsertWorkingMemorySection(_id, heading, body) {
      const prev = workingMemoryByContact.get(args.contactId) ?? '# Memory\n'
      workingMemoryByContact.set(args.contactId, `${prev}\n## ${heading}\n\n${body}\n`)
    },
    async appendWorkingMemory(_id, line) {
      const prev = workingMemoryByContact.get(args.contactId) ?? '# Memory\n'
      workingMemoryByContact.set(args.contactId, `${prev}\n${line}`)
    },
    async removeWorkingMemorySection() {
      /* noop */
    },
    async setSegments() {
      /* noop */
    },
    async setMarketingOptOut() {
      /* noop */
    },
    async resolveStaffByExternal(): Promise<StaffBinding | null> {
      return null
    },
    async bindStaff(): Promise<StaffBinding> {
      throw new Error('stubPhase3Ports: bindStaff not implemented')
    },
    async delete() {
      /* noop */
    },
  }

  const drive: DrivePort = {
    async get(): Promise<DriveFile | null> {
      return null
    },
    async getByPath(_scope: DriveScope) {
      return null
    },
    async listFolder() {
      return []
    },
    async readContent() {
      return { content: '' }
    },
    async grep() {
      return []
    },
    async create(): Promise<DriveFile> {
      throw new Error('stubPhase3Ports: drive.create not implemented')
    },
    async mkdir(): Promise<DriveFile> {
      throw new Error('stubPhase3Ports: drive.mkdir not implemented')
    },
    async move(): Promise<DriveFile> {
      throw new Error('stubPhase3Ports: drive.move not implemented')
    },
    async delete() {
      /* noop */
    },
    async ingestUpload(): Promise<DriveFile> {
      throw new Error('stubPhase3Ports: drive.ingestUpload not implemented')
    },
    async saveInboundMessageAttachment(): Promise<DriveFile> {
      throw new Error('stubPhase3Ports: drive.saveInboundMessageAttachment not implemented')
    },
    async deleteScope() {
      /* noop */
    },
  }

  return { agents, contacts, drive }
}

/** Boot a Phase-3 wake with sensible defaults for unit/integration tests. */
export async function bootWakeWorkspaceAgent(opts: MakePhase3Opts): Promise<BootWakeResult> {
  const basePorts = stubPhase3Ports({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
  })
  const ports: Phase3Ports = {
    agents: opts.overridePorts?.agents ?? basePorts.agents,
    contacts: opts.overridePorts?.contacts ?? basePorts.contacts,
    drive: opts.overridePorts?.drive ?? basePorts.drive,
  }

  const registrations = buildWorkspaceAgentRegistrations({
    contactId: opts.contactId,
    agentId: opts.agentId,
    llmCall: opts.llmCall,
    extraMutators: opts.extraMutators,
    extraObservers: opts.extraObservers,
    extraTools: opts.extraTools,
    extraCommands: opts.extraCommands,
    extraSideLoadContributors: opts.extraSideLoadContributors,
    extraMaterializers: opts.extraMaterializers,
  })

  return bootWake({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    conversationId: opts.conversationId,
    trigger: opts.trigger,
    provider: opts.provider,
    mockStreamFn: opts.mockStreamFn,
    maxTurns: opts.maxTurns ?? 1,
    preWakeWrites: opts.preWakeWrites,
    registrations,
    ports,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })
}
