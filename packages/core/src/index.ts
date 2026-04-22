// Engine
export { type CreateAppConfig, createApp } from './app';
// Contracts
export type { AuthAdapter, AuthSession, AuthUser } from './contracts/auth';
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
export type { ModuleInitContext } from './contracts/module';
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
// Context
export type { VobaseCtx, VobaseUser } from './ctx';
export { contextMiddleware, getCtx } from './ctx';
// DB
export { createDatabase, type VobaseDb } from './db';
export {
  createNanoid,
  DEFAULT_COLUMNS,
  NANOID_ALPHABET,
  NANOID_LENGTH,
  nanoidPrimaryKey,
} from './db/helpers';
// PostgreSQL Schemas
export { auditPgSchema, authPgSchema, infraPgSchema } from './db/pg-schemas';
// Circuit Breaker
export {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './infra/circuit-breaker';
// Errors
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
} from './infra/errors';
// HTTP Client
export {
  createHttpClient,
  type HttpClient,
  type HttpClientOptions,
  type HttpResponse,
  type RequestOptions,
} from './infra/http-client';
// Jobs
export type { JobDefinition, JobHandler, WorkerOptions } from './infra/job';
export { createWorker, defineJob } from './infra/job';
// Logger
export { logger } from './infra/logger';
// HMAC Signing
export { signHmac } from './infra/webhooks';
// Queue
export {
  createScheduler,
  type JobOptions,
  type ScheduleOptions,
  type Scheduler,
} from './infra/queue';
// Realtime (SSE + LISTEN/NOTIFY)
export type {
  CreateRealtimeOptions,
  RealtimeExecutor,
  RealtimePayload,
  RealtimeService,
} from './infra/realtime';
export { createNoopRealtime, createRealtimeService } from './infra/realtime';
// Throw Proxy
export { createThrowProxy } from './infra/throw-proxy';
// Webhooks
export {
  createWebhookRoutes,
  verifyHmacSignature,
  type WebhookConfig,
  webhookDedup,
} from './infra/webhooks';
// Module
export type { DefineModuleConfig, VobaseModule } from './module';
export { defineModule } from './module';
// Module Registry
export { registerModules } from './module-registry';
// Built-in Modules: Audit
export { auditLog, createAuditModule, recordAudits } from './modules/audit';
export { requestAuditMiddleware } from './modules/audit/middleware';
export { trackChanges } from './modules/audit/track-changes';
// Auth Module
export {
  type AuthModule,
  type AuthModuleConfig,
  createAuthModule,
  type SendInvitationEmail,
  type SendVerificationOTP,
} from './modules/auth';
// Auth Audit Hooks (re-exported from auth module)
export { createAuthAuditHooks } from './modules/auth/audit-hooks';
export {
  optionalSessionMiddleware,
  sessionMiddleware,
} from './modules/auth/middleware';
// RBAC
export {
  requireOrg,
  requirePermission,
  requireRole,
} from './modules/auth/permissions';
// Auth Schema (tables managed by better-auth)
export {
  authAccount,
  authApikey,
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authTeam,
  authTeamMember,
  authUser,
  authVerification,
} from './modules/auth/schema';
// Built-in Modules: Channels
export {
  type ChannelsModuleConfig,
  createChannelsModule,
  shouldUpdateStatus,
  WA_STATUS_ORDER,
  type EmailChannelConfig,
  type WhatsAppChannelConfig,
  type WhatsAppTransportConfig,
} from './modules/channels';
export {
  createResendAdapter,
  type ResendAdapterConfig,
} from './modules/channels/adapters/resend';
export {
  createSmtpAdapter,
  type SmtpAdapterConfig,
} from './modules/channels/adapters/smtp';
export { createWhatsAppAdapter } from './modules/channels/adapters/whatsapp';
export { channelsLog, channelsTemplates } from './modules/channels/schema';
export type { ChannelSend, ChannelsService, ProvisionChannelData } from './modules/channels/service';
// Built-in Modules: Integrations (replaces Credentials)
export {
  createIntegrationsModule,
  integrationsTable,
} from './modules/integrations';
export {
  getPlatformRefresh,
  getProviderRefreshFn,
  getRefreshMode,
  type PlatformRefreshFn,
  type ProviderRefreshFn,
  type RefreshResult,
  registerProviderRefresh,
  setPlatformRefresh,
} from './modules/integrations/refresh';
export type {
  ConnectOptions,
  Integration,
  IntegrationsService,
} from './modules/integrations/service';
// Built-in Modules: Sequences
export { createSequencesModule, sequences } from './modules/sequences';
export {
  nextSequence,
  type SequenceOptions,
} from './modules/sequences/next-sequence';
// Built-in Modules: Storage
export {
  createStorageModule,
  type StorageModuleConfig,
} from './modules/storage';
export { createLocalAdapter } from './modules/storage/adapters/local';
export { createS3Adapter } from './modules/storage/adapters/s3';
export { createStorageRoutes } from './modules/storage/routes';
export { storageObjects } from './modules/storage/schema';
export type {
  BucketConfig,
  BucketHandle,
  BucketListOptions,
  StorageObject,
  StorageService,
} from './modules/storage/service';
// Schemas
export { getActiveSchemas, type SchemaConfig } from './schemas';
