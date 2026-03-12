// Engine
export { type CreateAppConfig, createApp } from './app';

// Auth Module
export { createAuthModule, type AuthModuleConfig, type AuthModule } from './modules/auth';
export { sessionMiddleware, optionalSessionMiddleware } from './modules/auth/middleware';

// RBAC
export { requireRole, requirePermission, requireOrg } from './modules/auth/permissions';
export type { Permission, OrganizationContext } from './contracts/permissions';

// Contracts
export type { AuthAdapter, AuthSession, AuthUser } from './contracts/auth';
export type {
  StorageProvider,
  UploadOptions,
  PresignOptions,
  ListOptions,
  StorageListResult,
  StorageObjectInfo,
  LocalProviderConfig,
  S3ProviderConfig,
  StorageProviderConfig,
} from './contracts/storage';
export type {
  EmailProvider,
  EmailMessage,
  EmailAttachment,
  EmailResult,
  WhatsAppProvider,
  WhatsAppMessage,
  WhatsAppResult,
} from './contracts/notify';
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

// Built-in Modules: Credentials
export { createCredentialsModule, credentialsTable } from './modules/credentials';
export { encrypt, decrypt, getCredential, setCredential, deleteCredential } from './modules/credentials/encrypt';

// Schemas
export { getActiveSchemas, type SchemaConfig } from './schemas';

// Throw Proxy
export { createThrowProxy } from './infra/throw-proxy';

// Built-in Modules: Storage
export { createStorageModule, type StorageModuleConfig } from './modules/storage';
export { createLocalProvider } from './modules/storage/providers/local';
export { createS3Provider } from './modules/storage/providers/s3';
export { createStorageRoutes } from './modules/storage/routes';
export { storageObjects } from './modules/storage/schema';
export type { StorageService, BucketConfig, BucketHandle, StorageObject, BucketListOptions } from './modules/storage/service';

// Built-in Modules: Notify
export { createNotifyModule, type NotifyModuleConfig } from './modules/notify';
export { notifyLog } from './modules/notify/schema';
export { createResendProvider, type ResendConfig } from './modules/notify/providers/resend';
export { createSmtpProvider, type SmtpConfig } from './modules/notify/providers/smtp';
export { createWabaProvider, type WabaConfig } from './modules/notify/providers/waba';
export type { NotifyService, EmailChannel, WhatsAppChannel } from './modules/notify/service';

// Webhooks
export { type WebhookConfig, verifyHmacSignature, createWebhookRoutes, webhookDedup } from './infra/webhooks';
