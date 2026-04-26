// ─── Contracts ───────────────────────────────────────────────────────

// ─── Adapters ────────────────────────────────────────────────────────
export {
  createResendAdapter,
  type ResendAdapterConfig,
} from './adapters/channels/resend'
export {
  createSmtpAdapter,
  type SmtpAdapterConfig,
} from './adapters/channels/smtp'
export {
  type CreateTemplateInput,
  createWhatsAppAdapter,
  WhatsAppApiError,
  type WhatsAppChannelConfig,
  type WhatsAppCtaUrlInteractive,
  type WhatsAppTemplate,
  type WhatsAppTransportConfig,
} from './adapters/channels/whatsapp'
export { createLocalAdapter } from './adapters/storage/local'
export { createS3Adapter } from './adapters/storage/s3'
export type {
  AuthAdapter,
  AuthSession,
  AuthUser,
  CreateApiKey,
  RevokeApiKey,
  VerifyApiKey,
} from './contracts/auth'
export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvent,
  ChannelMedia,
  MessageReceivedEvent,
  OutboundMedia,
  OutboundMessage,
  ReactionEvent,
  SendResult,
  StatusUpdateEvent,
} from './contracts/channels'
export type { OrganizationContext, Permission } from './contracts/permissions'
export type {
  ListOptions,
  LocalAdapterConfig,
  PresignOptions,
  S3AdapterConfig,
  StorageAdapter,
  StorageAdapterConfig,
  StorageListResult,
  StorageObjectInfo,
  UploadOptions,
} from './contracts/storage'
// ─── DB ──────────────────────────────────────────────────────────────
export { createDatabase, type VobaseDb } from './db'
export {
  createNanoid,
  DEFAULT_COLUMNS,
  NANOID_ALPHABET,
  NANOID_LENGTH,
  nanoidPrimaryKey,
} from './db/helpers'
export {
  auditPgSchema,
  authPgSchema,
  harnessPgSchema,
  infraPgSchema,
} from './db/pg-schemas'
// ─── Declarative resources ──────────────────────────────────────────
export {
  type Authored,
  type AuthoredColumnsOpts,
  authoredColumns,
  authoredConstraints,
  bindDeclarativeTable,
  type DeclarativeResource,
  type DefineDeclarativeResourceOpts,
  defineDeclarativeResource,
  getDeclarativeResource,
  getDeclarativeTable,
  listDeclarativeResources,
  type Origin,
  type ParsedFile,
  type ParseFileContext,
  parseFileBytes,
  type ResourceFormat,
  serializeMarkdownFrontmatter,
  serializeYaml,
} from './declarative'
// ─── Errors ──────────────────────────────────────────────────────────
export {
  conflict,
  ERROR_CODES,
  type ErrorCode,
  errorHandler,
  forbidden,
  notFound,
  unauthorized,
  VobaseError,
  validation,
} from './errors'
export {
  type CreateAgentsMdChainOpts,
  createAgentsMdChainContributor,
  deriveTouchedDirsFromBashHistory,
} from './harness/agents-md-chain'
// ─── Harness governance ──────────────────────────────────────────────
export {
  type ApprovalGate,
  type ApprovalGateDeps,
  createApprovalGate,
  DEFAULT_APPROVAL_TTL_MS,
  expireApproval,
  expireOverdueApprovals,
  installApprovalGate,
  requestApproval,
  resolveApproval,
  setApprovalGateDb,
} from './harness/approval-gate'
// ─── Harness primitives ──────────────────────────────────────────────────
export {
  BASH_PREVIEW_BYTES,
  type BashToolArgs,
  type BashToolResult,
  makeBashTool,
} from './harness/bash-tool'
export { classifyError } from './harness/classify-error'
// ─── Harness persistence services ────────────────────────────────────
export {
  type CostService,
  type CostServiceDeps,
  createCostService,
  getDailySpend,
  installCostService,
  type RecordCostInput,
  recordCostUsage,
  setCostDb,
} from './harness/cost'
export {
  type CostCapDecision,
  type CostCapEvalInput,
  type CostCapEvalResult,
  evaluateCostCap,
  releaseCostCapWake,
} from './harness/cost-cap'
export {
  type AgentAbortedEvent,
  type AgentEndEvent,
  type AgentStartEvent,
  type CapturedPrompt,
  type CreateHarnessOpts,
  createHarness,
  type HarnessAgentDefinition,
  type HarnessBaseFields,
  type HarnessEvent,
  type HarnessGovernance,
  type HarnessHandle,
  type HarnessHooks,
  type HarnessLogger,
  type HarnessWakeTriggerKind,
  type HarnessWorkspace,
  type LlmCallEvent,
  type MessageEndEvent,
  type MessageStartEvent,
  type MessageUpdateEvent,
  type OnEventListener,
  type OnToolCallCtx,
  type OnToolCallListener,
  type OnToolResultCtx,
  type OnToolResultListener,
  type RunHarnessResult,
  type SteerInjectedEvent,
  type StreamFnLike,
  type ToolExecutionEndEvent,
  type ToolExecutionStartEvent,
  type TurnEndEvent,
  type TurnStartEvent,
  type WakeScope,
} from './harness/create-harness'
export {
  type ConcurrencyGate,
  createConcurrencyGate,
  type DispatchOrphan,
  type JournalDispatchCompleteInput,
  type JournalDispatchInput,
  journalDispatchComplete,
  journalDispatchStart,
  mintIdempotencyKey,
  type ResolveOrphansInput,
  type ResolveOrphansResult,
  resolveDispatchOrphans,
  scanDispatchOrphans,
} from './harness/dispatch'
export {
  type AssertFrozenInput,
  assertFrozenForWake,
  buildFrozenSnapshot,
  type FrozenSnapshot,
  FrozenSnapshotViolationError,
} from './harness/frozen-snapshot'
export {
  type CreateIdleResumptionOpts,
  createIdleResumptionContributor,
  type GetLastActivityTime,
} from './harness/idle-resumption'
export {
  append as journalAppend,
  createJournalService,
  getLastWakeTail as journalGetLastWakeTail,
  getLatestTurnIndex as journalGetLatestTurnIndex,
  installJournalService,
  type JournalAppendInput,
  type JournalEventLike,
  type JournalService,
  type JournalServiceDeps,
  setDb as setJournalDb,
} from './harness/journal'
export {
  type LlmCallArgs,
  type LlmEmitter,
  type LlmRequest,
  type LlmResult,
  llmCall,
} from './harness/llm-call'
export {
  loadMessages,
  type MessageHistoryDb,
  type ResolveThreadOpts,
  resolveThread,
} from './harness/message-history'
export {
  createRestartRecoveryContributor,
  type GetLastWakeTail,
  type GetWakeEvents,
  type RecoverDispatchesInput,
  type RecoverDispatchesResult,
  recoverOrphanedDispatches,
} from './harness/restart-recovery'
export {
  type CollectSideLoadOpts,
  type CustomSideLoadMaterializer,
  collectSideLoad,
  createBashHistoryMaterializer,
} from './harness/side-load-collector'
export { createSteerQueue, type SteerQueueHandle } from './harness/steer-queue'
export {
  appendChildEvent as appendSubagentChildEvent,
  cascadeAbort as cascadeSubagentAbort,
  DEFAULT_MAX_SUBAGENT_DEPTH,
  getSubagentChildren,
  getSubagentDepth,
  registerSubagent,
  releaseSubagentWake,
  SubagentDepthExceededError,
  subagentJournalNamespace,
  unregisterSubagent,
} from './harness/subagent'
export {
  type SpillDeps,
  type SpillOutput,
  spillToFile,
} from './harness/tool-budget-spill'
export {
  L1_PREVIEW_BYTES,
  L2_SPILL_BYTES,
  L3_CEILING_BYTES,
  TurnBudget,
} from './harness/turn-budget'
export type {
  AbortContext,
  AgentTool,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  BudgetPhase,
  BudgetState,
  ClassifiedError,
  ClassifiedErrorReason,
  CommandContext,
  CommandDef,
  CostThresholdCrossedEvent,
  ErrResult,
  FrozenSnapshotViolationEvent,
  HarnessPlatformHint,
  IterationBudget,
  MaterializerCtx,
  MaterializerPhase,
  OkResult,
  SideLoadContributor,
  SideLoadCtx,
  SideLoadItem,
  SideLoadKind,
  ToolContext,
  ToolDispatchCompletedEvent,
  ToolDispatchLostEvent,
  ToolDispatchStartedEvent,
  ToolResult,
  ToolResultPersistedEvent,
  WakeRuntime,
  WakeState,
  WakeStateChangedEvent,
  WorkspaceMaterializer,
} from './harness/types'
export { newWakeId } from './harness/wake-id'
export {
  type ActiveWakesStore,
  acquire as acquireActiveWake,
  createInMemoryActiveWakes,
  getWorker as getActiveWakeWorker,
  release as releaseActiveWake,
  sweepStale as sweepStaleActiveWakes,
} from './harness/wake-registry'
export {
  createWithJournaledTx,
  type JournaledTxDb,
  type JournalSink,
  MissingJournalAppendError,
  type RawJournalAppend,
  type Tx,
  type WithJournaledTxInput,
} from './harness/with-journaled-tx'
// ─── HMAC + Webhooks ─────────────────────────────────────────────────
export {
  createWebhookRoutes,
  signHmac,
  verifyHmacSignature,
  type WebhookConfig,
  webhookDedup as webhookDedupTable,
} from './hmac'
// ─── HTTP ────────────────────────────────────────────────────────────
export {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './http/circuit-breaker'
export {
  createHttpClient,
  type HttpClient,
  type HttpClientOptions,
  type HttpResponse,
  type RequestOptions,
} from './http/client'
export type { JobDefinition, JobHandler, WorkerOptions } from './jobs/job'
// ─── Jobs ────────────────────────────────────────────────────────────
export { createWorker, defineJob } from './jobs/job'
export {
  createScheduler,
  type JobOptions,
  type ScheduleOptions,
  type Scheduler,
} from './jobs/queue'
// ─── Logger ──────────────────────────────────────────────────────────
export { type CreateLoggerOpts, createLogger, type LogLevel, logger } from './logger'
// ─── Module contract + boot loop ─────────────────────────────────────
export {
  type AgentContributions,
  type CollectedWebRoute,
  collectAgentContributions,
  collectJobs,
  collectWebRoutes,
} from './module/collect'
export {
  bootModules,
  InvalidModuleError,
  type ModuleDef,
  type ModuleInitCtx,
  type ModuleRoutes,
  sortModules,
} from './module/module-def'
export type {
  CreateRealtimeOptions,
  RealtimeExecutor,
  RealtimePayload,
  RealtimeService,
} from './realtime'
// ─── Realtime (SSE + LISTEN/NOTIFY) ──────────────────────────────────
export { createNoopRealtime, createRealtimeService } from './realtime'
// ─── Scheduler types ─────────────────────────────────────────────────
export type { JobDef, ScheduleOpts, ScopedScheduler } from './scheduler/types'
// ─── Schemas ─────────────────────────────────────────────────────────
export { auditLog, recordAudits } from './schemas/audit'
export {
  apikeyTableMap,
  authAccount,
  authApikey,
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authTableMap,
  authTeam,
  authTeamMember,
  authUser,
  authVerification,
  organizationTableMap,
} from './schemas/auth'
export { channelsLog, channelsTemplates } from './schemas/channels'
export {
  activeWakes,
  agentMessages,
  auditWakeMap,
  type ConversationEvent,
  conversationEvents,
  pendingApprovals,
  tenantCostDaily,
  threads,
} from './schemas/harness'
export { integrationsTable } from './schemas/integrations'
export { sequences } from './schemas/sequences'
export { storageObjects } from './schemas/storage'
export { webhookDedup } from './schemas/webhook-dedup'
// ─── Workspace primitives ────────────────────────────────────────────────
export {
  type GenerateAgentsMdOpts,
  generateAgentsMd,
} from './workspace/agents-md-generator'
export {
  type AgentRole,
  type Catalog,
  type CatalogRouteOpts,
  type CatalogVerb,
  type CliDispatchRouteOpts,
  type CliVerbBodyArgs,
  type CliVerbDef,
  CliVerbRegistry,
  type CliVerbResult,
  createCatalogRoute,
  createCliDispatchRoute,
  createInProcessTransport,
  createVobaseCommand,
  DEFAULT_READ_ONLY_VERBS,
  type DefineCliVerbOpts,
  defaultRouteForVerb,
  defineCliVerb,
  findCommand,
  type InProcessTransportOpts,
  resolveCommandSet,
  type VerbContext,
  type VerbEvent,
  type VerbFormat,
  type VerbResult,
  type VerbTransport,
  VobaseCliCollisionError,
  type VobaseDispatcherOpts,
} from './workspace/cli'
export {
  type CreateWorkspaceOpts,
  createWorkspace,
  type WorkspaceHandle,
} from './workspace/create-workspace'
export {
  type DirtyDiff,
  DirtyTracker,
  snapshotFs,
} from './workspace/dirty-tracker'
export {
  type BuildIndexFileOpts,
  defineIndexContributor,
  type IndexContributor,
  type IndexContributorContext,
  IndexFileBuilder,
} from './workspace/index-file-builder'
export { MaterializerRegistry } from './workspace/materializer-registry'
export {
  type BuildReadOnlyConfigOpts,
  buildReadOnlyConfig,
  checkWriteAllowed,
  globToRegExp,
  isWritablePath,
  type ReadOnlyConfig,
  ReadOnlyFsError,
  ScopedFs,
  type WriteContext,
} from './workspace/ro-enforcer'
