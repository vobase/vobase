// Engine
export { type CreateAppConfig, createApp } from './app';

// Auth Module
export { createAuthModule, type AuthModuleConfig, type AuthModule } from './modules/auth';
export { sessionMiddleware, optionalSessionMiddleware } from './modules/auth/middleware';

// Auth Schema (tables managed by better-auth)
export {
  authUser,
  authSession,
  authAccount,
  authVerification,
  authApikey,
  authOrganization,
  authMember,
  authInvitation,
} from './modules/auth/schema';

// RBAC
export { requireRole, requirePermission, requireOrg } from './modules/auth/permissions';
export type { Permission, OrganizationContext } from './contracts/permissions';

// Contracts
export type { AuthAdapter, AuthSession, AuthUser } from './contracts/auth';
export type {
  StorageAdapter,
  UploadOptions,
  PresignOptions,
  ListOptions,
  StorageListResult,
  StorageObjectInfo,
  LocalAdapterConfig,
  S3AdapterConfig,
  StorageAdapterConfig,
} from './contracts/storage';
export type {
  ChannelAdapter,
  ChannelEvent,
  MessageReceivedEvent,
  StatusUpdateEvent,
  ReactionEvent,
  ChannelMedia,
  ChannelCapabilities,
  OutboundMessage,
  OutboundMedia,
  SendResult,
} from './contracts/channels';
export type { ModuleInitContext } from './contracts/module';

// Context
export type { VobaseCtx, VobaseUser } from './ctx';
export { contextMiddleware, getCtx } from './ctx';

// Circuit Breaker
export { CircuitBreaker, type CircuitBreakerOptions } from './infra/circuit-breaker';

// HTTP Client
export {
  createHttpClient,
  type HttpClient,
  type HttpClientOptions,
  type HttpResponse,
  type RequestOptions,
} from './infra/http-client';

// DB
export { createDatabase, type VobaseDb } from './db';
export {
  createNanoid,
  DEFAULT_COLUMNS,
  NANOID_ALPHABET,
  NANOID_LENGTH,
  nanoidPrimaryKey,
} from './db/helpers';

// Errors
export {
  conflict,
  dbBusy,
  ERROR_CODES,
  type ErrorCode,
  errorHandler,
  forbidden,
  notFound,
  unauthorized,
  VobaseError,
  validation,
} from './infra/errors';

// Jobs
export type { JobDefinition, JobHandler, WorkerOptions } from './infra/job';
export { createWorker, defineJob } from './infra/job';

// Logger
export { logger } from './infra/logger';

// Auth Audit Hooks (re-exported from auth module)
export { createAuthAuditHooks } from './modules/auth/audit-hooks';

// Module
export type { DefineModuleConfig, VobaseModule } from './module';
export { defineModule } from './module';

// Module Registry
export { registerModules } from './module-registry';

// Queue
export { createScheduler, type JobOptions, type Scheduler } from './infra/queue';

// Built-in Modules: Audit
export { createAuditModule, auditLog, recordAudits } from './modules/audit';
export { trackChanges } from './modules/audit/track-changes';
export { requestAuditMiddleware } from './modules/audit/middleware';

// Built-in Modules: Sequences
export { createSequencesModule, sequences } from './modules/sequences';
export { nextSequence, type SequenceOptions } from './modules/sequences/next-sequence';

// Built-in Modules: Integrations (replaces Credentials)
export { createIntegrationsModule, integrationsTable } from './modules/integrations';
export type { IntegrationsService, Integration, ConnectOptions } from './modules/integrations/service';

// Schemas
export { getActiveSchemas, type SchemaConfig } from './schemas';

// Throw Proxy
export { createThrowProxy } from './infra/throw-proxy';

// Built-in Modules: Storage
export { createStorageModule, type StorageModuleConfig } from './modules/storage';
export { createLocalAdapter } from './modules/storage/adapters/local';
export { createS3Adapter } from './modules/storage/adapters/s3';
export { createStorageRoutes } from './modules/storage/routes';
export { storageObjects } from './modules/storage/schema';
export type { StorageService, BucketConfig, BucketHandle, StorageObject, BucketListOptions } from './modules/storage/service';

// Built-in Modules: Channels
export { createChannelsModule, type ChannelsModuleConfig, type WhatsAppChannelConfig, type EmailChannelConfig } from './modules/channels';
export { channelsLog, channelsTemplates } from './modules/channels/schema';
export { createResendAdapter, type ResendAdapterConfig } from './modules/channels/adapters/resend';
export { createSmtpAdapter, type SmtpAdapterConfig } from './modules/channels/adapters/smtp';
export { createWhatsAppAdapter } from './modules/channels/adapters/whatsapp';
export type { ChannelsService, ChannelSend } from './modules/channels/service';

// Webhooks
export { type WebhookConfig, verifyHmacSignature, createWebhookRoutes, webhookDedup } from './infra/webhooks';
