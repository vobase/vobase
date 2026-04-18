/**
 * R3 — compile-only integration gate. This file imports every export from every
 * contract file AND exercises every `AgentEvent` variant + every port method
 * signature in a type-only position.
 *
 * If any downstream lane needs a field that P1.0 didn't ship, `tsc` fails here
 * FIRST — before 5 lanes consume broken contracts.
 *
 * This file has NO runtime code. It is pure type-level assertions.
 *
 * Plan §P1.0 acceptance: TSC pass over this file is the P1.0 merge gate.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { AgentsPort } from '../agents-port'
import type { CaptionPort } from '../caption-port'
import type { V2ChannelAdapter } from '../channel-adapter'
import type { ChannelInboundEvent, ChannelOutboundEvent } from '../channel-event'
import type { ContactsPort } from '../contacts-port'
import type {
  AgentDefinition,
  Contact,
  Conversation,
  ConversationEvent,
  DriveFile,
  InternalNote,
  LearningProposal,
  Message,
  PendingApproval,
  StaffBinding,
} from '../domain-types'
import type { DrivePort, DriveScope } from '../drive-port'
import type {
  AgentEvent,
  AgentEventType,
  ChannelInboundAgentEvent,
  ChannelOutboundAgentEvent,
  LlmTask,
  WakeScheduledEvent,
  WakeTrigger,
  WakeTriggerKind,
} from '../event'
import type { InboxPort } from '../inbox-port'
import type { OptionalModuleDir, RequiredModuleFile } from '../module-shape'
import {
  type MAX_HANDLER_RAW_LOC,
  type OPTIONAL_MODULE_DIRS,
  type REQUIRED_MODULE_FILES,
  REQUIRED_README_FRONTMATTER,
} from '../module-shape'
import type { AgentMutator, AgentStep, MutatorContext, MutatorDecision, StepResult } from '../mutator'
import type { AgentObserver, Logger, ObserverContext } from '../observer'
import type { AgentTool, CommandDef, EventBus, PluginContext, RealtimeService } from '../plugin-context'
import type { LlmProvider, LlmStreamChunk } from '../provider-port'
import type {
  MaterializerCtx,
  MaterializerPhase,
  SideLoadContributor,
  SideLoadCtx,
  SideLoadItem,
  SideLoadKind,
  WorkspaceMaterializer,
} from '../side-load'
import type { ThreatCategory, ThreatMatch, ThreatScanner, ThreatScanResult } from '../threat-scan'
import type { ToolContext, AgentTool as TypedAgentTool } from '../tool'
import type { ToolResult } from '../tool-result'

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<_T extends true> = true

// ---------------------------------------------------------------------------
// AgentEvent union exhaustiveness — every type-literal must exist
// ---------------------------------------------------------------------------
type _EventTypes = AssertEqual<
  AgentEventType,
  | 'agent_start'
  | 'agent_end'
  | 'turn_start'
  | 'turn_end'
  | 'message_start'
  | 'message_update'
  | 'message_end'
  | 'tool_execution_start'
  | 'tool_execution_update'
  | 'tool_execution_end'
  | 'llm_call'
  | 'approval_requested'
  | 'approval_decided'
  | 'internal_note_added'
  | 'learning_proposed'
  | 'learning_approved'
  | 'learning_rejected'
  | 'channel_inbound'
  | 'channel_outbound'
  | 'wake_scheduled'
>
type _EventTypesCheck = AssertTrue<_EventTypes>

/** Exhaustive narrowing exercise — if a variant is missing this won't compile. */
export function assertAgentEventExhaustive(e: AgentEvent): string {
  switch (e.type) {
    case 'agent_start':
      return e.agentId + e.systemHash
    case 'agent_end':
      return e.reason
    case 'turn_start':
      return String(e.turnIndex)
    case 'turn_end':
      return String(e.tokensIn + e.tokensOut)
    case 'message_start':
      return e.messageId + e.role
    case 'message_update':
      return e.delta
    case 'message_end':
      return e.content
    case 'tool_execution_start':
      return e.toolName
    case 'tool_execution_update':
      return e.toolCallId
    case 'tool_execution_end':
      return e.toolName + String(e.isError)
    case 'llm_call':
      return e.task + e.model + String(e.cacheHit)
    case 'approval_requested':
      return e.approvalId
    case 'approval_decided':
      return e.approvalId + e.decision
    case 'internal_note_added':
      return e.noteId
    case 'learning_proposed':
      return e.proposalId + e.scope
    case 'learning_approved':
      return e.proposalId + e.writeId
    case 'learning_rejected':
      return e.reason
    case 'channel_inbound':
      return e.channelType + e.externalMessageId
    case 'channel_outbound':
      return e.channelType + e.toolName + e.contactId
    case 'wake_scheduled':
      return e.trigger + e.scheduledAt.toISOString()
  }
}

// ---------------------------------------------------------------------------
// Port method signatures — every method referenced by downstream lanes
// ---------------------------------------------------------------------------

type _InboxSurface = {
  [K in keyof InboxPort]: InboxPort[K]
}
type _ContactsSurface = {
  [K in keyof ContactsPort]: ContactsPort[K]
}
type _DriveSurface = {
  [K in keyof DrivePort]: DrivePort[K]
}
type _AgentsSurface = {
  [K in keyof AgentsPort]: AgentsPort[K]
}
type _CaptionSurface = {
  [K in keyof CaptionPort]: CaptionPort[K]
}

// Force a compile error if any key is removed/renamed
type _RequiredInboxMethods =
  | 'getConversation'
  | 'listMessages'
  | 'createConversation'
  | 'sendTextMessage'
  | 'sendCardMessage'
  | 'sendImageMessage'
  | 'sendMediaMessage'
  | 'resolve'
  | 'reassign'
  | 'hold'
  | 'reopen'
  | 'addInternalNote'
  | 'listInternalNotes'
  | 'insertPendingApproval'
  | 'beginCompaction'
  | 'createInboundMessage'
type _InboxKeys = AssertTrue<AssertEqual<keyof InboxPort, _RequiredInboxMethods>>

type _RequiredContactsMethods =
  | 'get'
  | 'getByPhone'
  | 'getByEmail'
  | 'upsertByExternal'
  | 'readWorkingMemory'
  | 'upsertWorkingMemorySection'
  | 'appendWorkingMemory'
  | 'removeWorkingMemorySection'
  | 'setSegments'
  | 'setMarketingOptOut'
  | 'resolveStaffByExternal'
  | 'bindStaff'
  | 'delete'
type _ContactsKeys = AssertTrue<AssertEqual<keyof ContactsPort, _RequiredContactsMethods>>

type _RequiredDriveMethods =
  | 'get'
  | 'getByPath'
  | 'listFolder'
  | 'readContent'
  | 'grep'
  | 'create'
  | 'mkdir'
  | 'move'
  | 'delete'
  | 'ingestUpload'
  | 'saveInboundMessageAttachment'
  | 'deleteScope'
type _DriveKeys = AssertTrue<AssertEqual<keyof DrivePort, _RequiredDriveMethods>>

type _RequiredAgentsMethods = 'getAgentDefinition' | 'appendEvent'
type _AgentsKeys = AssertTrue<AssertEqual<keyof AgentsPort, _RequiredAgentsMethods>>

// ---------------------------------------------------------------------------
// PluginContext registration surface — every `register*` + scoped client exists
// ---------------------------------------------------------------------------
type _PluginKeys = keyof PluginContext
type _RequiredPluginKeys =
  | 'moduleName'
  | 'tenantId'
  | 'conversationId'
  | 'ports'
  | 'registerTool'
  | 'registerSkill'
  | 'registerCommand'
  | 'registerChannel'
  | 'registerObserver'
  | 'registerMutator'
  | 'registerWorkspaceMaterializer'
  | 'contributeSideLoad'
  | 'db'
  | 'jobs'
  | 'storage'
  | 'events'
  | 'realtime'
  | 'logger'
  | 'metrics'
  | 'trace'
  | 'llmCall'
type _PluginCtxCheck = AssertTrue<AssertEqual<_PluginKeys, _RequiredPluginKeys>>

// ---------------------------------------------------------------------------
// Module-shape constants are readonly arrays of literals (data, not logic)
// ---------------------------------------------------------------------------
type _ShapeRequired = AssertTrue<AssertEqual<RequiredModuleFile, (typeof REQUIRED_MODULE_FILES)[number]>>
type _ShapeOptional = AssertTrue<AssertEqual<OptionalModuleDir, (typeof OPTIONAL_MODULE_DIRS)[number]>>
type _ShapeLocCheck = AssertTrue<AssertEqual<typeof MAX_HANDLER_RAW_LOC, 200>>
// Presence check — reads the constant to prevent dead-elim
const _keepReadmeFrontmatter: readonly string[] = REQUIRED_README_FRONTMATTER
void _keepReadmeFrontmatter

// ---------------------------------------------------------------------------
// Mutator / Observer / Materializer contracts — minimal instantiations
// ---------------------------------------------------------------------------
const _observerExample: AgentObserver = {
  id: 'example',
  handle: async (_event: AgentEvent, _ctx: ObserverContext): Promise<void> => undefined,
}
void _observerExample

const _mutatorExample: AgentMutator = {
  id: 'example',
  before: async (_step: AgentStep, _ctx: MutatorContext): Promise<MutatorDecision | undefined> => undefined,
  after: async (_s: AgentStep, r: StepResult, _c: MutatorContext): Promise<StepResult | undefined> => r,
}
void _mutatorExample

const _materializerExample: WorkspaceMaterializer = {
  path: '/workspace/AGENTS.md',
  phase: 'frozen',
  materialize: (_ctx: MaterializerCtx) => '',
}
void _materializerExample

const _sideLoadContributor: SideLoadContributor = async (ctx: SideLoadCtx) => [
  {
    kind: 'custom',
    priority: 1,
    render: () => `turn ${ctx.turnIndex}`,
  } satisfies SideLoadItem,
]
void _sideLoadContributor

// ---------------------------------------------------------------------------
// ToolResult envelope — both halves of the discriminated union compile
// ---------------------------------------------------------------------------
const _ok: ToolResult<{ body: string }> = { ok: true, content: { body: 'hello' } }
const _err: ToolResult<never> = { ok: false, error: 'boom', retryable: false }
void _ok
void _err

// ---------------------------------------------------------------------------
// WakeTrigger discriminants — all five variants instantiable
// ---------------------------------------------------------------------------
const _trig1: WakeTrigger = {
  trigger: 'inbound_message',
  conversationId: 'c1',
  messageIds: ['m1'],
}
const _trig2: WakeTrigger = {
  trigger: 'approval_resumed',
  conversationId: 'c1',
  approvalId: 'a1',
  decision: 'approved',
}
const _trig3: WakeTrigger = {
  trigger: 'supervisor',
  conversationId: 'c1',
  noteId: 'n1',
  authorUserId: 'u1',
}
const _trig4: WakeTrigger = {
  trigger: 'scheduled_followup',
  conversationId: 'c1',
  reason: 'nudge',
  scheduledAt: new Date(),
}
const _trig5: WakeTrigger = {
  trigger: 'manual',
  conversationId: 'c1',
  reason: 'dogfood',
  actorUserId: 'u1',
}
void _trig1
void _trig2
void _trig3
void _trig4
void _trig5

// ---------------------------------------------------------------------------
// DriveScope discriminants
// ---------------------------------------------------------------------------
const _scopeTenant: DriveScope = { scope: 'tenant' }
const _scopeContact: DriveScope = { scope: 'contact', contactId: 'k1' }
void _scopeTenant
void _scopeContact

// ---------------------------------------------------------------------------
// Domain shapes — reference every interface so downstream drift fails here
// ---------------------------------------------------------------------------
type _DomainKeep =
  | Conversation
  | Message
  | InternalNote
  | PendingApproval
  | Contact
  | StaffBinding
  | AgentDefinition
  | DriveFile
  | LearningProposal
  | ConversationEvent

type _RealtimeKeep = RealtimeService
type _BusKeep = EventBus
type _LoggerKeep = Logger
type _CommandKeep = CommandDef
type _ToolKeep = AgentTool
type _ThreatKeep = ThreatCategory | ThreatMatch | ThreatScanResult | ThreatScanner

type _LlmTaskKeep = AssertTrue<
  AssertEqual<
    LlmTask,
    | 'agent.turn'
    | 'agent.compaction'
    | 'scorer.answer_relevancy'
    | 'scorer.faithfulness'
    | 'moderation'
    | 'memory.distill'
    | 'learn.propose'
    | 'drive.caption.image'
    | 'drive.caption.video'
    | 'drive.extract.pdf'
    | 'intent.classify'
  >
>

type _MaterializerPhaseKeep = AssertTrue<AssertEqual<MaterializerPhase, 'frozen' | 'side-load' | 'on-read'>>

type _SideLoadKindKeep = AssertTrue<
  AssertEqual<
    SideLoadKind,
    'working_memory' | 'pending_approvals' | 'delivery_status' | 'internal_notes_delta' | 'drive_hint' | 'custom'
  >
>

type _WakeTriggerKindKeep = AssertTrue<
  AssertEqual<WakeTriggerKind, 'inbound_message' | 'approval_resumed' | 'supervisor' | 'scheduled_followup' | 'manual'>
>

// ---------------------------------------------------------------------------
// Phase 2 new contracts (P2.0) — type-only instantiations
// ---------------------------------------------------------------------------

// channel-event.ts: both Zod-inferred shapes must be structurally correct
type _InboundEvt = ChannelInboundEvent
const _inboundSample: _InboundEvt = {
  tenantId: 't1',
  channelType: 'whatsapp',
  externalMessageId: 'wamid.ABC',
  from: '+6512345678',
  profileName: 'Alice',
  content: 'hello',
  contentType: 'text',
  timestamp: Date.now(),
}
void _inboundSample

type _OutboundEvt = ChannelOutboundEvent
const _outboundSample: _OutboundEvt = {
  tenantId: 't1',
  conversationId: 'c1',
  contactId: 'k1',
  wakeId: 'w1',
  channelType: 'web',
  toolName: 'reply',
  payload: { text: 'hi' },
}
void _outboundSample

// channel-adapter.ts: V2ChannelAdapter structurally extends core ChannelAdapter
type _V2Adapter = V2ChannelAdapter
type _HasSendOutboundEvent = AssertTrue<'sendOutboundEvent' extends keyof _V2Adapter ? true : false>
type _HasSend = AssertTrue<'send' extends keyof _V2Adapter ? true : false>

// provider-port.ts: LlmProvider and all LlmStreamChunk variants
type _ProviderKeep = LlmProvider
type _StreamChunkKeep = AssertTrue<
  AssertEqual<LlmStreamChunk['type'], 'text-delta' | 'tool-use-start' | 'tool-use-delta' | 'tool-use-end' | 'finish'>
>

// tool.ts: typed AgentTool envelope + ToolContext with approval decision carrier
type _TypedTool = TypedAgentTool<{ text: string }, { sent: boolean }>
type _ToolContextKeep = ToolContext
type _HasApprovalDecision = AssertTrue<'approvalDecision' extends keyof ToolContext ? true : false>
type _HasRequiresApproval = AssertTrue<'requiresApproval' extends keyof TypedAgentTool ? true : false>

// New AgentEvent variant shapes (type-only instantiation)
type _ChanInboundEvt = ChannelInboundAgentEvent
type _ChanOutboundEvt = ChannelOutboundAgentEvent
type _WakeSchEvt = WakeScheduledEvent

const _chanIn: _ChanInboundEvt = {
  type: 'channel_inbound',
  ts: new Date(),
  wakeId: 'w1',
  conversationId: 'c1',
  tenantId: 't1',
  turnIndex: 0,
  channelType: 'whatsapp',
  externalMessageId: 'wamid.XYZ',
}
void _chanIn

const _chanOut: _ChanOutboundEvt = {
  type: 'channel_outbound',
  ts: new Date(),
  wakeId: 'w1',
  conversationId: 'c1',
  tenantId: 't1',
  turnIndex: 0,
  channelType: 'web',
  toolName: 'reply',
  contactId: 'k1',
}
void _chanOut

const _wakeSched: _WakeSchEvt = {
  type: 'wake_scheduled',
  ts: new Date(),
  wakeId: 'w1',
  conversationId: 'c1',
  tenantId: 't1',
  turnIndex: 0,
  trigger: 'scheduled_followup',
  scheduledAt: new Date(Date.now() + 3600_000),
}
void _wakeSched

// ---------------------------------------------------------------------------
// Explicit re-exports so bundlers + type-only consumers see the surface
// ---------------------------------------------------------------------------
export type {
  AgentDefinition,
  AgentEvent,
  AgentEventType,
  AgentsPort,
  AgentTool,
  CaptionPort,
  CommandDef,
  Contact,
  ContactsPort,
  Conversation,
  ConversationEvent,
  DriveFile,
  DrivePort,
  EventBus,
  InboxPort,
  InternalNote,
  LearningProposal,
  LlmTask,
  Logger,
  MaterializerCtx,
  MaterializerPhase,
  Message,
  ObserverContext,
  PendingApproval,
  PluginContext,
  SideLoadCtx,
  SideLoadItem,
  StaffBinding,
  ThreatScanner,
  ToolResult,
  WakeTrigger,
  WorkspaceMaterializer,
}
