import type { VobaseDb } from '../db/client';
import type { HttpClient } from '../http-client';
import type { EmailProvider } from './notify';
import type { StorageProvider } from './storage';
import type { Scheduler } from '../queue';

/**
 * Context passed to a module's `init` hook during app boot.
 * Provides access to core infrastructure services.
 */
export interface ModuleInitContext {
  db: VobaseDb;
  scheduler: Scheduler;
  storage: StorageProvider;
  http: HttpClient;
  notify: EmailProvider;
}
