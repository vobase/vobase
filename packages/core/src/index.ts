// ─── Contracts ───────────────────────────────────────────────────────
export type {
  AuthAdapter,
  AuthSession,
  AuthUser,
  CreateApiKey,
  RevokeApiKey,
  VerifyApiKey,
} from './contracts/auth';
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
} from './contracts/channels';
export type { OrganizationContext, Permission } from './contracts/permissions';
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
} from './contracts/storage';

// ─── DB ──────────────────────────────────────────────────────────────
export { createDatabase, type VobaseDb } from './db';
export {
  createNanoid,
  DEFAULT_COLUMNS,
  NANOID_ALPHABET,
  NANOID_LENGTH,
  nanoidPrimaryKey,
} from './db/helpers';
export { auditPgSchema, authPgSchema, infraPgSchema } from './db/pg-schemas';

// ─── Schemas ─────────────────────────────────────────────────────────
export { auditLog, recordAudits } from './schemas/audit';
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
} from './schemas/auth';
export { channelsLog, channelsTemplates } from './schemas/channels';
export { integrationsTable } from './schemas/integrations';
export { sequences } from './schemas/sequences';
export { storageObjects } from './schemas/storage';
export { webhookDedup } from './schemas/webhook-dedup';

// ─── Errors ──────────────────────────────────────────────────────────
export {
  conflict,
  ERROR_CODES,
  type ErrorCode,
  errorHandler,
  forbidden,
  notFound,
  unauthorized,
  validation,
  VobaseError,
} from './errors';

// ─── Logger ──────────────────────────────────────────────────────────
export { logger } from './logger';

// ─── HTTP ────────────────────────────────────────────────────────────
export {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './http/circuit-breaker';
export {
  createHttpClient,
  type HttpClient,
  type HttpClientOptions,
  type HttpResponse,
  type RequestOptions,
} from './http/client';

// ─── Jobs ────────────────────────────────────────────────────────────
export { createWorker, defineJob } from './jobs/job';
export type { JobDefinition, JobHandler, WorkerOptions } from './jobs/job';
export {
  createScheduler,
  type JobOptions,
  type ScheduleOptions,
  type Scheduler,
} from './jobs/queue';

// ─── Realtime (SSE + LISTEN/NOTIFY) ──────────────────────────────────
export { createNoopRealtime, createRealtimeService } from './realtime';
export type {
  CreateRealtimeOptions,
  RealtimeExecutor,
  RealtimePayload,
  RealtimeService,
} from './realtime';

// ─── HMAC + Webhooks ─────────────────────────────────────────────────
export {
  createWebhookRoutes,
  signHmac,
  verifyHmacSignature,
  type WebhookConfig,
  webhookDedup as webhookDedupTable,
} from './hmac';

// ─── Adapters ────────────────────────────────────────────────────────
export {
  createResendAdapter,
  type ResendAdapterConfig,
} from './adapters/channels/resend';
export {
  createSmtpAdapter,
  type SmtpAdapterConfig,
} from './adapters/channels/smtp';
export {
  createWhatsAppAdapter,
  type CreateTemplateInput,
  type WhatsAppChannelConfig,
  type WhatsAppCtaUrlInteractive,
  type WhatsAppTemplate,
  type WhatsAppTransportConfig,
  WhatsAppApiError,
} from './adapters/channels/whatsapp';
export { createLocalAdapter } from './adapters/storage/local';
export { createS3Adapter } from './adapters/storage/s3';

// ─── Harness primitives ──────────────────────────────────────────────────
export {
  BASH_PREVIEW_BYTES,
  type BashToolArgs,
  type BashToolResult,
  makeBashTool,
} from './harness/bash-tool';
export { classifyError } from './harness/classify-error';
export {
  type CustomSideLoadMaterializer,
  type CollectSideLoadOpts,
  collectSideLoad,
  createBashHistoryMaterializer,
} from './harness/side-load-collector';
export {
  createRestartRecoveryContributor,
  type GetLastWakeTail,
} from './harness/restart-recovery';
export { createSteerQueue, type SteerQueueHandle } from './harness/steer-queue';
export {
  L1_PREVIEW_BYTES,
  L2_SPILL_BYTES,
  L3_CEILING_BYTES,
  TurnBudget,
} from './harness/turn-budget';
export { spillToFile, type SpillDeps, type SpillOutput } from './harness/tool-budget-spill';
export { newWakeId } from './harness/wake-id';
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
} from './harness/types';

// ─── Workspace primitives ────────────────────────────────────────────────
export {
  type GenerateAgentsMdOpts,
  generateAgentsMd,
} from './workspace/agents-md-generator';
export { type DirtyDiff, DirtyTracker, snapshotFs } from './workspace/dirty-tracker';
export { MaterializerRegistry } from './workspace/materializer-registry';
export {
  buildReadOnlyConfig,
  checkWriteAllowed,
  isWritablePath,
  type ReadOnlyConfig,
  ReadOnlyFsError,
  ScopedFs,
  WRITABLE_PREFIXES,
} from './workspace/ro-enforcer';
