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
  __resetCostServiceForTests,
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
  type AgentAbortedEvent,
  type AgentEndEvent,
  type AgentStartEvent,
  type CapturedPrompt,
  type CreateHarnessOpts,
  createHarness,
  type HarnessAgentDefinition,
  type HarnessBaseFields,
  type HarnessEvent,
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
  __resetJournalServiceForTests,
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
  loadMessages,
  type MessageHistoryDb,
  type ResolveThreadOpts,
  resolveThread,
} from './harness/message-history'
export {
  createRestartRecoveryContributor,
  type GetLastWakeTail,
} from './harness/restart-recovery'
export {
  type CollectSideLoadOpts,
  type CustomSideLoadMaterializer,
  collectSideLoad,
  createBashHistoryMaterializer,
} from './harness/side-load-collector'
export { createSteerQueue, type SteerQueueHandle } from './harness/steer-queue'
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
  BudgetPhase,
  BudgetState,
  ClassifiedError,
  ClassifiedErrorReason,
  CommandContext,
  CommandDef,
  ErrResult,
  IterationBudget,
  MaterializerCtx,
  MaterializerPhase,
  OkResult,
  SideLoadContributor,
  SideLoadCtx,
  SideLoadItem,
  SideLoadKind,
  ToolContext,
  ToolResult,
  ToolResultPersistedEvent,
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
export { logger } from './logger'
export type {
  CreateRealtimeOptions,
  RealtimeExecutor,
  RealtimePayload,
  RealtimeService,
} from './realtime'
// ─── Realtime (SSE + LISTEN/NOTIFY) ──────────────────────────────────
export { createNoopRealtime, createRealtimeService } from './realtime'
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
  type DirtyDiff,
  DirtyTracker,
  snapshotFs,
} from './workspace/dirty-tracker'
export { MaterializerRegistry } from './workspace/materializer-registry'
export {
  type BuildReadOnlyConfigOpts,
  buildReadOnlyConfig,
  checkWriteAllowed,
  isWritablePath,
  type ReadOnlyConfig,
  ReadOnlyFsError,
  ScopedFs,
} from './workspace/ro-enforcer'
