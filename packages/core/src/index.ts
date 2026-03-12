// Engine
export { type CreateAppConfig, createApp } from './app';

// Auth
export { type Auth, type CreateAuthOptions, createAuth } from './auth';

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
export { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker';

// HTTP Client
export {
  createHttpClient,
  type HttpClient,
  type HttpClientOptions,
  type HttpResponse,
  type RequestOptions,
} from './http-client';

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
} from './errors';

// Jobs
export type { JobDefinition, JobHandler, WorkerOptions } from './job';
export { createWorker, defineJob } from './job';

// Logger
export { logger } from './logger';

// Middleware
export {
  optionalSessionMiddleware,
  sessionMiddleware,
} from './middleware/session';

// Module
export type { DefineModuleConfig, VobaseModule } from './module';
export { defineModule } from './module';

// Module Registry
export { registerModules } from './module-registry';

// Queue
export { createScheduler, type JobOptions, type Scheduler } from './queue';

// Built-in Modules: Audit
export { createAuditModule, auditLog, recordAudits } from './modules/audit';
export { trackChanges } from './modules/audit/track-changes';
export { requestAuditMiddleware, createAuthAuditHooks } from './modules/audit/middleware';

// Built-in Modules: Sequences
export { createSequencesModule, sequences } from './modules/sequences';
export { nextSequence, type SequenceOptions } from './modules/sequences/next-sequence';

// Built-in Modules: Credentials
export { createCredentialsModule, credentialsTable } from './modules/credentials';
export { encrypt, decrypt, getCredential, setCredential, deleteCredential } from './modules/credentials/encrypt';

// Schemas
export { getActiveSchemas, type SchemaConfig } from './schemas';

// Throw Proxy
export { createThrowProxy } from './throw-proxy';

// Storage (Phase 1: simple local storage, will be replaced by storage module in Phase 2)
export { createStorage, type Storage } from './storage';

// Webhooks
export { type WebhookConfig, verifyHmacSignature, createWebhookRoutes, webhookDedup } from './webhooks';
